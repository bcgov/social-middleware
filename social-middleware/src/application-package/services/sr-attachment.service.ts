import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import {
  ApplicationFormType,
  getFormIdForFormType,
} from '../../application-form/enums/application-form-types.enum';
import { ApplicationForm } from '../../application-form/schemas/application-form.schema';
import { ApplicationFormService } from '../../application-form/services/application-form.service';
import { AttachmentsService } from '../../attachments/attachments.service';
import { UserService } from '../../auth/user.service';
import { UserUtil } from '../../common/utils/user.util';
import { SiebelApiService } from '../../siebel/siebel-api.service';

@Injectable()
export class SrAttachmentService {
  constructor(
    private readonly applicationFormService: ApplicationFormService,
    private readonly siebelApiService: SiebelApiService,
    private readonly userService: UserService,
    private readonly userUtil: UserUtil,
    private readonly attachmentsService: AttachmentsService,
    @InjectPinoLogger(SrAttachmentService.name)
    private readonly logger: PinoLogger,
  ) {}
  /**
   * Attach forms to a service request, and upload the user-attached files for
   * any member whose forms are marked userAttachedForm.
   * Failures are logged per item and do not stop the others; the caller decides what a partial result means.
   */
  async attachFormsToSr(
    serviceRequestId: string,
    forms: ApplicationForm[],
    context: { applicationPackageId: string },
  ): Promise<{ attempted: number; succeeded: number }> {
    // track householdMemberIds that should use attachments instead of forms
    const householdMembersUsingAttachments = new Set<string>();

    const attachmentResults = [];
    for (const form of forms) {
      try {
        // if this form uses attached files, skip it and track the householdMemberId
        if (form.userAttachedForm) {
          householdMembersUsingAttachments.add(form.householdMemberId);
          this.logger.info(
            {
              applicationFormId: form.applicationFormId,
              householdMemberId: form.householdMemberId,
              formType: form.type,
            },
            'Form marked with userAttachedForm - will use attachments instead',
          );
          continue; // skip this form
        }
        if (form.siebelAttachmentId) {
          this.logger.info(
            {
              applicationFormId: form.applicationFormId,
              siebelAttachmentId: form.siebelAttachmentId,
            },
            'Form already attached to Siebel, skipping',
          );
          attachmentResults.push({
            applicationFormId: form.applicationFormId,
            attachmentId: form.siebelAttachmentId,
          });
          continue;
        }
        // form has not already been uploaded, and has some form data which indicates it is a valid form.
        if (form.formData) {
          // Atomically claim this form for attachment — only one concurrent caller wins.
          const claimedForm =
            await this.applicationFormService.claimFormForAttachment(
              form.applicationFormId,
            );

          if (!claimedForm) {
            this.logger.info(
              { applicationFormId: form.applicationFormId },
              'Form attachment already claimed by a concurrent submission — skipping',
            );
            continue;
          }
          let fileName = form.type as string;

          try {
            // files need to have unique names, so for screening forms, add the household member's name
            if (
              (form.type === ApplicationFormType.DISCLOSURECONSENT ||
                form.type === ApplicationFormType.PCCCONSENT) &&
              form.userId
            ) {
              const memberUser = await this.userService.findOne(form.userId);

              if (memberUser) {
                const { firstName } = this.userUtil.firstAndMiddleName(
                  memberUser.first_name,
                );
                fileName = `${firstName}_${this.userUtil.toTitleCase(memberUser.last_name)}-${form.type}`;
              } else {
                this.logger.warn(
                  {
                    applicationFormId: form.applicationFormId,
                    userId: form.userId,
                  },
                  'Could not find household member for screening form - using default filename',
                );
              }
            }
            const fileContent = form.formData; // Buffer.from(formDataString).toString('base64');
            const formId = getFormIdForFormType(form.type);
            const xmlHierarchy =
              await this.applicationFormService.convertFormDataToXml(
                form.applicationFormId,
              );

            const attachmentResult =
              (await this.siebelApiService.createFormAttachment(
                serviceRequestId,
                {
                  fileName: fileName,
                  template: formId,
                  xmlHierarchy: xmlHierarchy,
                  fileContent: fileContent,
                },
              )) as { items: { Id: string } };
            await this.applicationFormService.saveSiebelAttachmentId(
              form.applicationFormId,
              attachmentResult.items?.Id,
            );

            attachmentResults.push({
              applicationFormId: form.applicationFormId,
              attachmentId: attachmentResult.items?.Id,
            });

            this.logger.info(
              {
                serviceRequestId: serviceRequestId,
                applicationFormId: form.applicationFormId,
                fileName: fileName,
              },
              'Attachment created successfully for form',
            );
          } catch (error) {
            await this.applicationFormService.releaseAttachmentClaim(
              form.applicationFormId,
            );
            throw error; // re-throw so the existing outer catch still logs it the same way
          }
        } else {
          this.logger.warn(
            { applicationFormId: form.applicationFormId },
            'Skipping form with no data for attachment',
          );
        }
      } catch (error) {
        this.logger.error(
          {
            error,
            applicationFormId: form.applicationFormId,
            serviceRequestId: serviceRequestId,
          },
          'Failed to create attachment for form',
        );
      }
    }

    // Attach all attachments for householdMembers using attachments
    for (const householdMemberId of householdMembersUsingAttachments) {
      try {
        this.logger.info(
          { householdMemberId },
          'Fetching attachments for household member',
        );

        // Get all attachments for this household member (without file data)
        const attachmentList =
          await this.attachmentsService.findByHouseholdMemberId(
            householdMemberId,
          );

        this.logger.info(
          { householdMemberId, attachmentCount: attachmentList.length },
          'Found attachments to upload',
        );

        // Upload each attachment to Siebel
        for (const attachmentMeta of attachmentList) {
          try {
            if (attachmentMeta.icmAttachmentId) {
              this.logger.info(
                {
                  attachmentId: attachmentMeta.attachmentId,
                  icmAttachmentId: attachmentMeta.icmAttachmentId,
                },
                'Attachment already uploaded to ICM, skipping',
              );
              attachmentResults.push({
                attachmentId: attachmentMeta.attachmentId,
                siebelAttachmentId: attachmentMeta.icmAttachmentId,
              });
              continue;
            }

            // Get the full attachment with file data
            const fullAttachment = await this.attachmentsService.findById(
              attachmentMeta.attachmentId,
            );

            if (!fullAttachment || !fullAttachment.fileData) {
              this.logger.warn(
                { attachmentId: attachmentMeta.attachmentId },
                'Attachment not found or has no file data',
              );
              continue;
            }
            const attachmentResult =
              (await this.siebelApiService.createAttachment(serviceRequestId, {
                fileName: fullAttachment.fileName,
                fileContent: fullAttachment.fileData,
                fileType: fullAttachment.fileType,
                category: 'Consent',
                description:
                  fullAttachment.description ||
                  `Attachment for household member`,
              })) as { items: { Id: string } };
            await this.attachmentsService.saveIcmAttachmentId(
              fullAttachment.attachmentId,
              attachmentResult.items.Id,
            );

            attachmentResults.push({
              attachmentId: fullAttachment.attachmentId,
              siebelAttachmentId: attachmentResult.items.Id,
            });
            this.logger.info(
              {
                serviceRequestId: serviceRequestId,
                attachmentId: fullAttachment.attachmentId,
                fileName: fullAttachment.fileName,
                householdMemberId,
              },
              'Attachment uploaded successfully for household member',
            );
          } catch (error) {
            this.logger.error(
              {
                error,
                attachmentId: attachmentMeta.attachmentId,
                householdMemberId,
              },
              'Failed to upload attachment for household member',
            );
          }
        }
      } catch (error) {
        this.logger.error(
          {
            error,
            householdMemberId,
          },
          'Failed to fetch attachments for household member',
        );
      }
    }
    this.logger.info(
      {
        serviceRequestId: serviceRequestId,
        totalForms: forms.length,
        successfulAttachments: attachmentResults.length,
      },
      `Completed attachment creation for ${attachmentResults.length}/${forms.length} forms`,
    );
    if (attachmentResults.length !== forms.length) {
      this.logger.warn(
        {
          applicationPackageId: context.applicationPackageId,
          expectedAttachments: forms.length,
          successfulAttachments: attachmentResults.length,
          failedAttachments: forms.length - attachmentResults.length,
        },
        'Some forms failed to attach to Siebel - submission continuing with partial attachments',
      );
    }
    return { attempted: forms.length, succeeded: attachmentResults.length };
  }
}
