/* eslint-disable prettier/prettier */
import {
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { Model } from 'mongoose';
import {
  ApplicationForm,
  ApplicationFormDocument,
} from '../schemas/application-form.schema';
import { FormType } from '../enums/form-type.enum';
import {
  FormParameters,
  FormParametersDocument,
} from '../schemas/form-parameters.schema';
import { CreateApplicationFormDto } from '../dto/create-application-form.dto';
import {
  ApplicationFormType,
  getFormIdForFormType,
  getScreeningFormRecipe,
} from '../enums/application-form-types.enum';
import { ApplicationFormStatus } from '../enums/application-form-status.enum';
import { AccessCodeService } from '../../household/services/access-code.service';
import { HouseholdService } from '../../household/services/household.service';
import { GetApplicationFormDto } from '../dto/get-application-form.dto';
import { DeleteApplicationFormDto } from '../dto/delete-application-form.dto';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
} from 'src/application-package/schema/application-package.schema';
import { NewTokenDto } from '../dto/new-token.dto';
import { SubmitApplicationFormDto } from '../dto/submit-application-form.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';

@Injectable()
export class ApplicationFormService {
  constructor(
    @InjectModel(ApplicationForm.name)
    private applicationFormModel: Model<ApplicationFormDocument>,
    @InjectModel(FormParameters.name)
    private formParametersModel: Model<FormParametersDocument>,
    @InjectModel(ApplicationPackage.name)
    private applicationPackageModel: Model<ApplicationPackageDocument>,
    @InjectPinoLogger(ApplicationFormService.name)
    private readonly logger: PinoLogger,
    private readonly eventEmitter: EventEmitter2,
    private readonly accessCodeService: AccessCodeService,
    private readonly householdService: HouseholdService,
  ) {}

  async createApplicationForm(
    dto: CreateApplicationFormDto,
  ): Promise<{ applicationFormId: string }> {
    const applicationFormId = uuidv4();
    const formAccessToken = uuidv4();

    try {
      this.logger.info('Creating new application form');
      this.logger.debug(
        {
          applicationPackageId: dto.applicationPackageId,
          applicationFormId: applicationFormId,
          userId: dto.userId,
          formId: dto.formId,
          type: dto.type,
          formAccessToken: formAccessToken,
        },
        'Key Info',
      );

      const applicationForm = new this.applicationFormModel({
        applicationFormId,
        applicationPackageId: dto.applicationPackageId,
        userId: dto.userId,
        householdMemberId: dto.householdMemberId,
        formId: dto.formId,
        type: dto.type,
        formData: null,
      });

      await applicationForm.save();

      this.logger.info({ applicationFormId }, 'Saved application form to DB');

      const newFormDto = {
        applicationFormId: applicationFormId,
        type: FormType.New,
        formId: dto.formId,
        formParameters: {
          formId: dto.formId,
          language: 'en',
        },
      };

      await this.newFormAccessToken(newFormDto);

      return { applicationFormId };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create application');
      throw new InternalServerErrorException('Application creation failed.');
    }
  }

  async createScreeningFormsAndAccessCode(
    applicationPackageId: string,
    householdMemberId: string,
  ): Promise<{
    accessCode?: string; 
    expiresAt?: Date; 
  }> {
    try {

      this.logger.info('Creating Screening Forms and Access Code');

      const householdMember = await this.householdService.findById(householdMemberId);

      if(!householdMember) {
        throw new InternalServerErrorException(
          'Household member not found',
        );
      }

      const formsToCreate = getScreeningFormRecipe(householdMember.relationshipToPrimary)

      for(const formType of formsToCreate) {

        const formDto = {
          applicationPackageId: applicationPackageId,
          formId: getFormIdForFormType(formType),
          householdMemberId: householdMemberId,
          type: formType,
          formParameters: {},
        };

        await this.createApplicationForm(formDto);

      }

      const { accessCode, expiresAt } =
        await this.accessCodeService.createAccessCode(
          applicationPackageId,
          householdMemberId,
        );

      return {
        accessCode,
        expiresAt,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to create screening application');
      throw new InternalServerErrorException(
        'Screening application creation failed',
      );
    }
  }

  async newFormAccessToken(dto: NewTokenDto): Promise<string> {
    this.logger.debug('Passed applicationFormIdX:', dto.applicationFormId);

    try {
      // Get the latest form parameters for this application
      const latestFormParameters = await this.formParametersModel
        .findOne({ applicationFormId: { $eq: dto.applicationFormId } })
        .sort({ createdAt: -1 })
        .lean()
        .exec();

      const formAccessToken = uuidv4();

      if (latestFormParameters) {
        // Reuse existing parameters but with new token
        this.logger.info('Re-using form parameters');
        const formParamters = new this.formParametersModel({
          applicationFormId: dto.applicationFormId,
          type: latestFormParameters.type,
          formId: latestFormParameters.formId,
          formAccessToken: formAccessToken,
          formParameters: latestFormParameters.formParameters, // Reuse existing
        });
        await formParamters.save();
      } else {
        // Create new parameters using the dto
        this.logger.info('Creating new form parameters');
        if (dto.type && dto.formId && dto.formParameters) {
          const formParamters = new this.formParametersModel({
            applicationFormId: dto.applicationFormId,
            type: dto.type,
            formId: dto.formId,
            formAccessToken: formAccessToken,
            formParameters: dto.formParameters, // Reuse existing
          });
          await formParamters.save();
        } else {
          this.logger.error('Cannot create new token without form meta data');
          throw new InternalServerErrorException(
            'Failed to create new form access token',
          );
        }
      }
      return formAccessToken;
    } catch (error) {
      if (error instanceof NotFoundException) {
        // Re-throw NotFoundException (from the !formParameters check)
        throw error;
      }
      // Log and handle unexpected database errors
      this.logger.error(
        { error },
        `Error generating formAccessToken for application: ${dto.applicationFormId}`,
      );
      throw new InternalServerErrorException(
        'Failed to generate form access token',
      );
    }
  }

  // a user can own a form
  // but so can a householdMember
  async confirmOwnership(
    applicationFormId: string,
    userId: string,
  ): Promise<boolean> {
    try {


    // check direct ownership
    const directOwnership = await this.applicationFormModel
      .findOne({ applicationFormId: { $eq: applicationFormId }, userId })
      .lean()
      .exec();

    if (directOwnership) {
      this.logger.info(
        {applicationFormId, userId},
        'Form owned by user',
      );
      return true;
    }

    // check via householdmembership
    const householdMembers = await this.householdService.findByUserId(userId);

    if (!householdMembers || householdMembers.length === 0) {
      this.logger.info(
        {applicationFormId, userId},
        'No household memberships found for user; no form ownership possible',
      );
      return false;
    }
    // there may be multiple memberships for the user
    for (const member of householdMembers) {
      const householdForm = await this.applicationFormModel.findOne({applicationFormId: {$eq: applicationFormId}, householdMemberId: member.householdMemberId,}).lean().exec();

      if (householdForm) {
        this.logger.info(
          { applicationFormId, userId, householdMemberId: member.householdMemberId },
          'Form owned via household member association',
        );
        return true;
      }
    }

    this.logger.info (
      { applicationFormId, userId},
      'Form not found for user or their household memberships',
    );
    return false;
  } catch (error) {
    this.logger.error(
      { error, applicationFormId, userId },
      'Error confirming form ownership',
    );
    return false;
  }
  }

  async getApplicationFormsByUser(
    userId: string,
    types?: ApplicationFormType[], // optional form type filter for front end
  ): Promise<GetApplicationFormDto[]> {
    try {
      this.logger.info(
        { userId, types },
        'Fetching application forms for user',
      );

      // build the query - add type filter if types are specified
      const query: { userId: string; type?: { $in: ApplicationFormType[] } } = {
        userId,
      };
      if (types && types.length > 0) {
        query.type = { $in: types };
      }

      // Find all application forms for the user (exclude formData to reduce payload)
      const forms = await this.applicationFormModel
        .find(query, { formData: 0 })
        .lean();

      if (!forms.length) {
        this.logger.info({ userId }, 'No application forms found for user');
        return [];
      }

      // Fetch corresponding formIds from FormParameters
      const applicationFormIds = forms.map((form) => form.applicationFormId);
      const formParameters = await this.formParametersModel
        .find(
          { applicationFormId: { $in: applicationFormIds } },
          { applicationFormId: 1, formId: 1 },
        )
        .lean();

      // Map applicationId -> formId
      const formIdMap = new Map(
        formParameters.map((fp) => [fp.applicationFormId, fp.formId]),
      );

      // Build final DTO array
      const results: GetApplicationFormDto[] = forms.map((form) => ({
        applicationFormId: form.applicationFormId,
        applicationPackageId: form.applicationPackageId,
        formId: formIdMap.get(form.applicationFormId) ?? '',
        userId: form.userId,
        householdMemberId: form.householdMemberId,
        userAttachedForm: form.userAttachedForm,
        type: form.type,
        status: form.status,
        submittedAt: form.submittedAt ?? null,
        updatedAt: form.updatedAt,
      }));

      this.logger.info(
        { userId, count: results.length },
        'Application forms fetched successfully',
      );

      return results;
    } catch (error) {
      this.logger.error({ error, userId }, 'Failed to fetch application forms');
      throw new InternalServerErrorException(
        'Failed to fetch application forms for user',
      );
    }
  }

  async getApplicationFormsByPackageId(
    applicationPackageId: string,
    userId: string,
  ): Promise<GetApplicationFormDto[]> {
    try {
      // Validate package ownership
      const appPackage = await this.applicationPackageModel
        .findOne({ applicationPackageId })
        .lean();

      if (!appPackage) {
        throw new NotFoundException(
          `Application package ${applicationPackageId} not found`,
        );
      }

      if (appPackage.userId !== userId) {
        throw new ForbiddenException(
          `User does not have access to this package`,
        );
      }
      this.logger.info(
        { applicationPackageId },
        'Fetching application forms for package',
      );

      const forms = await this.applicationFormModel
        .find({ applicationPackageId })
        .lean();

      if (!forms.length) {
        this.logger.info(
          { applicationPackageId },
          'No application forms found for package',
        );
        return [];
      }

      // Fetch corresponding formIds from FormParameters
      const applicationFormIds = forms.map((form) => form.applicationFormId);
      const formParameters = await this.formParametersModel
        .find(
          { applicationFormId: { $in: applicationFormIds } },
          { applicationFormId: 1, formId: 1 },
        )
        .lean();

      const formIdMap = new Map(
        formParameters.map((fp) => [fp.applicationFormId, fp.formId]),
      );

      const results: GetApplicationFormDto[] = forms.map((form) => ({
        applicationFormId: form.applicationFormId,
        applicationPackageId: form.applicationPackageId,
        formId: formIdMap.get(form.applicationFormId) ?? '',
        userId: form.userId,
        householdMemberId: form.householdMemberId,
        userAttachedForm: form.userAttachedForm,
        type: form.type,
        status: form.status,
        updatedAt: form.updatedAt,
        submittedAt: form.submittedAt ?? null,
      }));

      this.logger.info(
        { applicationPackageId, count: results.length },
        'Application forms fetched successfully',
      );
      return results;
    } catch (error) {
      this.logger.error(
        { error, applicationPackageId },
        'Failed to fetch application forms for package',
      );
      throw new InternalServerErrorException(
        'Failed to fetch application forms for package',
      );
    }
  }

  // used by front end to determine the current state of the applicationForm
  async getApplicationFormById(
    applicationFormId: string,
  ): Promise<GetApplicationFormDto | null> {
    try {
      this.logger.info(
        { applicationFormId },
        'Fetching application form by ID',
      );

      // Find the application form (without formData to keep response light)
      const form = await this.applicationFormModel
        .findOne(
          {
            applicationFormId: { $eq: applicationFormId },
          },
          { formData: 0 },
        )
        .lean()
        .exec();

      if (!form) {
        this.logger.info(
          { applicationFormId},
          'Application form not found or access denied',
        );
        return null;
      }

      // Get the corresponding formId from FormParameters
      const formParameters = await this.formParametersModel
        .findOne(
          { applicationFormId: { $eq: applicationFormId } },
          { formId: 1 },
        )
        .lean()
        .exec();

      const result: GetApplicationFormDto = {
        applicationFormId: form.applicationFormId,
        applicationPackageId: form.applicationPackageId,
        formId: formParameters?.formId ?? '',
        userId: form.userId,
        householdMemberId: form.householdMemberId,
        userAttachedForm: form.userAttachedForm,
        type: form.type,
        status: form.status,
        submittedAt: form.submittedAt ?? null,
        updatedAt: form.updatedAt,
      };

      this.logger.info(
        { applicationFormId},
        'Application form fetched successfully',
      );

      return result;
    } catch (error) {
      this.logger.error(
        { error, applicationFormId},
        'Failed to fetch application form by ID',
      );
      throw new InternalServerErrorException(
        'Failed to fetch application form',
      );
    }
  }
  
  async getApplicationFormsForUser(userId: string): Promise<GetApplicationFormDto[][]>{
    // returns applicationForms grouped by householdMemberId; 
    // used to access household screenings
    // it's possible (but perhaps unusual) that an user is part of multiple household definitions
    // so it needs to be an array
    try {
      // get all households the user belongs to
      const householdMembers = await this.householdService.findByUserId(userId);
      // ignore the ones they are the primary applicant on; they will be accessed through the applicationPackage
      const nonPrimaryMembers = householdMembers.filter(member=> member.relationshipToPrimary != RelationshipToPrimary.Self);
      // get all forms related to those household memberships
      const allForms = await Promise.all(
        // for each household
        nonPrimaryMembers.map(async (member) => {
          // get the application forms that belong to that household membership
          const forms = this.getApplicationFormByHouseholdId(member.householdMemberId);
          // filter to the forms that are allowed for screenings; this depends on the relationship they have
          // e.g. spouses get a different screening form than a non-spouse household member
          const allowedFormTypes = getScreeningFormRecipe(member.relationshipToPrimary);
          return (await forms).filter(form => allowedFormTypes.includes(form.type));
        })
      );
      // only return array values for households that include forms (e.g. not primary applicant forms)
      return allForms.filter(formArray => formArray.length > 0);
    } catch(error) {
      this.logger.error(
        { error, userId },
        'No household records found for user',
      );
      throw error;
    }
  }

  // used by front end to determine the current state of the applicationForm
  async getApplicationFormByHouseholdId(
    householdMemberId: string,
  ): Promise<GetApplicationFormDto[]> {
    try {
      this.logger.info(
        { householdMemberId},
        'Fetching application form by household memberID',
      );

      // Find the application form (without formData to keep response light)
      const forms = await this.applicationFormModel
        .find(
          {
            householdMemberId: { $eq: householdMemberId},
          },
          { formData: 0 },
        )
        .lean()
        .exec();

      if (!forms) {
        this.logger.info(
          { householdMemberId},
          'No application forms found for household member',
        );
        return [];
      }

      // Map each form to the DTO
      const results: GetApplicationFormDto[] = await Promise.all(
        forms.map(async (form) => {
          // Get the corresponding formId from FormParameters
          const formParameters = await this.formParametersModel
            .findOne(
              { applicationFormId: form.applicationFormId },
              { formId: 1 },
            )
            .lean()
            .exec();

          return {
            applicationFormId: form.applicationFormId,
            applicationPackageId: form.applicationPackageId,
            formId: formParameters?.formId ?? '',
            userId: form.userId,
            householdMemberId: form.householdMemberId,
            type: form.type,
            status: form.status,
            userAttachedForm: form.userAttachedForm,
            submittedAt: form.submittedAt ?? null,
            updatedAt: form.updatedAt,
          };
        })
      );

      this.logger.info(
        { householdMemberId, count: results.length },
        'Successfully fetched application forms for household member',
      );

      return results;


    } catch (error) {
      this.logger.error(
        { error, householdMemberId },
        'Error fetching application forms by household member ID',
      );
      throw error;
    }
  }

  // for the front-end. we need to verify whether a user is associated with a householdMemberId
  // in order to show them their forms
  async verifyHouseholdMemberAccess(
    householdMemberId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const householdMember = await this.householdService.findById(householdMemberId);

      if (!householdMember) {
        this.logger.warn(
          { householdMemberId, userId },
          'Household member not found for access verification',
        );
        return false;
      }

      // Check if the household member is associated with this user
      if (householdMember.userId !== userId) {
        this.logger.warn(
          { householdMemberId, requestUserId: userId, householdUserId: householdMember.userId },
          'User does not have access to this household member',
        );
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error(
        { error, householdMemberId, userId },
        'Error verifying household member access',
      );
      return false;
    }
  }

  async submitApplicationForm(
    dto: SubmitApplicationFormDto,
    status: ApplicationFormStatus
  ): Promise<void> {
    try {
      this.logger.info('Saving application', dto.token);
      this.logger.debug('Saving application for token', dto.token);
      //this.logger.info('Status ', dto.status);

      const record = await this.formParametersModel
        .findOne({ formAccessToken: { $eq: dto.token } })
        .select('applicationFormId')
        .lean()
        .exec();

      if (!record) {
        throw new NotFoundException(`Token ${dto.token} not found`);
      }
      const updated = await this.applicationFormModel
        .findOneAndUpdate(
          { applicationFormId: record.applicationFormId },
          {
            $set: {
              formData: dto.jsonToSave,
              status: status,
            },
          },
          { new: true },
        )
        .exec();

      if (!updated) {
        throw new NotFoundException(
          `Application ${record.applicationFormId} not found`,
        );
      }

      this.logger.info('Application saved  to DB ', record.applicationFormId);
    } catch (err) {
      if (err instanceof HttpException) {
        // Re-throw known HTTP exceptions (404, 400)
        throw err;
      }
      this.logger.error('Error submitting application', err);
      throw new InternalServerErrorException('Could not save form data');
    }
  }

  async markUserAttachedForms(
    householdMemberId: string,
    userId: string,
  ): Promise<void> {
    try {
      this.logger.info(
        {householdMemberId, userId},
        'Marking application form as user attached',
      )

      await this.applicationFormModel
        .updateMany( 
          { householdMemberId: { $eq: householdMemberId} }, 
          //{ $set: {userAttachedForm: true, status: ApplicationFormStatus.COMPLETE} }, 
          //{ new: true},
          {
            $set: {
              userAttachedForm: true,
              status: ApplicationFormStatus.COMPLETE,
            }
          }
        )
        .exec();
      
      this.logger.info({
        householdMemberId,
      }, 'Successfully marked form as user attached',);

    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error
      }
      this.logger.error({ error, householdMemberId }, 'Failed to mark form as user attached');
      throw new InternalServerErrorException(
        'Failed to update application form',
      );
    }
  }

  async cancelApplicationForm(dto: DeleteApplicationFormDto): Promise<void> {
    const { applicationFormId } = dto;

    this.logger.info(
      { applicationFormId },
      'Starting application cancellation',
    );

    // check to see if the user owns the application in question
    const application = await this.applicationFormModel
      .findOne({ applicationFormId })
      .exec();

    if (!application) {
      throw new NotFoundException(`Application ${applicationFormId} not found`);
    }

    // Delete form parameters
    await this.formParametersModel.deleteMany({ applicationFormId }).exec();

    // Delete the main application
    await this.applicationFormModel.findByIdAndDelete(application._id).exec();

    this.logger.info(
      { applicationFormId },
      'ApplicationForm cancelled successfully',
    );
  }

  async findByIdAndUser(
    applicationFormId: string,
    userId: string,
  ): Promise<ApplicationFormDocument | null> {
    try {
      const application = await this.applicationFormModel
        .findOne({
          applicationFormId: applicationFormId,
          userId: userId,
        })
        .exec();

      return application;
    } catch (error) {
      this.logger.error(
        { error, applicationFormId, userId },
        'Error finding application by ID and user',
      );
      return null;
    }
  }

  async findByPackageAndUser(
    applicationPackageId: string,
    userId: string,
  ): Promise<ApplicationForm[]> {
    return await this.applicationFormModel
      .find({ applicationPackageId, userId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  // returns application form metadata, without formData
  async findShortByPackageAndUser(
    applicationPackageId: string,
    userId: string,
  ): Promise<ApplicationForm[]> {
    return await this.applicationFormModel
      .find({ applicationPackageId, userId })
      .select('-formData')
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  // returns all applicationforms, even those assigned to other userIds (screening forms, etc.)
  async findAllByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<ApplicationForm[]> {
    return await this.applicationFormModel
      .find({ applicationPackageId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  async deleteByApplicationPackageId(
    applicationPackageId: string,
  ): Promise<void> {
    await this.applicationFormModel
      .deleteMany({ applicationPackageId: applicationPackageId })
      .exec();
  }
}
