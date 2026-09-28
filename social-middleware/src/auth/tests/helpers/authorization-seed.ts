import { v4 as uuidv4 } from 'uuid';

import { ApplicationFormStatus } from 'src/application-form/enums/application-form-status.enum';
import {
  ApplicationFormType,
  getFormIdForFormType,
} from 'src/application-form/enums/application-form-types.enum';
import { FormType } from 'src/application-form/enums/form-type.enum';
import {
  ApplicationPackageStatus,
  ServiceRequestStage,
} from 'src/application-package/enums/application-package-status.enum';
import { ApplicationPackageSubType } from 'src/application-package/enums/application-package-subtypes.enum';
import { AttachmentType } from 'src/attachments/enums/attachment-types.enum';
import { AccessCodeType } from 'src/household/enums/access-code-type.enum';
import { MemberTypes } from 'src/household/enums/member-types.enum';
import { RelationshipToPrimary } from 'src/household/enums/relationship-to-primary.enum';
import { GenderTypes } from '../../../household/enums/gender-types.enum';
import { AuthorizationModels } from './authorization-harness';

export interface SeededPerson {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export interface SeededUser extends SeededPerson {
  userId: string;
  bcServicesCardId: string;
  email: string;
}

export interface SeededMember extends SeededPerson {
  householdMemberId: string;
  relationshipToPrimary: RelationshipToPrimary;
  linkedUserId: string | null;
}

export interface SeededForm {
  applicationFormId: string;
  accessToken: string;
}

export interface AuthorizationWorld {
  userA: SeededUser;
  userB: SeededUser;
  userM: SeededUser;
  packageA: { applicationPackageId: string; srId: string };
  packageB: { applicationPackageId: string; srId: string };
  memberA: {
    self: SeededMember;
    spouse: SeededMember;
    partner: SeededMember;
    commonLaw: SeededMember;
    child: SeededMember;
    linked: SeededMember;
  };
  memberB: { self: SeededMember };
  formA: SeededForm;
  formB: SeededForm;
  attachmentA: { attachmentId: string };
  attachmentB: { attachmentId: string };
  accessCodeA: { code: string };
  accessCodeB: { code: string };
}

async function seedUser(
  models: AuthorizationModels,
  person: SeededPerson,
  bcServicesCardId: string,
  email: string,
): Promise<SeededUser> {
  const created = await models.user.create({
    bc_services_card_id: bcServicesCardId,
    first_name: person.firstName,
    last_name: person.lastName,
    email,
    dateOfBirth: person.dateOfBirth,
    street_address: '123 Test St',
    city: 'Victoria',
    country: 'CA',
    region: 'BC',
    postal_code: 'V8W 1A1',
  });
  return {
    ...person,
    userId: String(created._id),
    bcServicesCardId,
    email,
  };
}

async function seedMember(
  models: AuthorizationModels,
  packageId: string,
  person: SeededPerson,
  relationshipToPrimary: RelationshipToPrimary,
  memberType: MemberTypes,
  linkedUserId: string | null,
): Promise<SeededMember> {
  const householdMemberId = uuidv4();
  await models.householdMember.create({
    householdMemberId,
    applicationPackageId: packageId,
    firstName: person.firstName,
    lastName: person.lastName,
    dateOfBirth: person.dateOfBirth,
    email: `${person.firstName.toLowerCase()}@example.com`,
    memberType,
    genderType: GenderTypes.Unspecified,
    relationshipToPrimary,
    userId: linkedUserId,
    requireScreening: true,
    screeningInfoProvided: false,
  });
  return {
    ...person,
    householdMemberId,
    relationshipToPrimary,
    linkedUserId,
  };
}

async function seedScreeningForms(
  models: AuthorizationModels,
  packageId: string,
  member: SeededMember,
): Promise<void> {
  for (const type of [
    ApplicationFormType.DISCLOSURECONSENT,
    ApplicationFormType.PCCCONSENT,
  ]) {
    await models.applicationForm.create({
      applicationFormId: uuidv4(),
      applicationPackageId: packageId,
      householdMemberId: member.householdMemberId,
      userId: member.linkedUserId ?? undefined,
      type,
      status: ApplicationFormStatus.COMPLETE,
      formData: 'eyJxIjoiYSJ9',
    });
  }
}

async function seedApplicationForm(
  models: AuthorizationModels,
  packageId: string,
  member: SeededMember,
): Promise<SeededForm> {
  const applicationFormId = uuidv4();
  await models.applicationForm.create({
    applicationFormId,
    applicationPackageId: packageId,
    householdMemberId: member.householdMemberId,
    userId: member.linkedUserId ?? undefined,
    type: ApplicationFormType.ABOUTME,
    status: ApplicationFormStatus.COMPLETE,
    formData: 'eyJxIjoiYSJ9',
  });
  const accessToken = uuidv4();
  await models.formParameters.create({
    applicationFormId,
    type: FormType.New,
    formId: getFormIdForFormType(ApplicationFormType.ABOUTME),
    formAccessToken: accessToken,
    formParameters: { appCode: 'TEST-FORM' },
  });
  return { applicationFormId, accessToken };
}

export async function seedTwoApplicants(
  models: AuthorizationModels,
): Promise<AuthorizationWorld> {
  const userA = await seedUser(
    models,
    { firstName: 'Alice', lastName: 'APPLICANT', dateOfBirth: '1980-01-15' },
    'bcsc-A-0001',
    'alice@example.com',
  );
  const userB = await seedUser(
    models,
    { firstName: 'Bob', lastName: 'BYSTANDER', dateOfBirth: '1982-07-22' },
    'bcsc-B-0002',
    'bob@example.com',
  );
  const userM = await seedUser(
    models,
    { firstName: 'Mia', lastName: 'MEMBER', dateOfBirth: '1985-03-10' },
    'bcsc-M-0003',
    'mia@example.com',
  );

  const packageA = {
    applicationPackageId: uuidv4(),
    srId: 'SR-AUTH-A-001',
  };
  const packageB = {
    applicationPackageId: uuidv4(),
    srId: 'SR-AUTH-B-002',
  };
  await models.applicationPackage.create([
    {
      applicationPackageId: packageA.applicationPackageId,
      userId: userA.userId,
      subtype: ApplicationPackageSubType.FCH,
      srId: packageA.srId,
      srStage: ServiceRequestStage.APPLICATION,
      status: ApplicationPackageStatus.APPLICATION,
    },
    {
      applicationPackageId: packageB.applicationPackageId,
      userId: userB.userId,
      subtype: ApplicationPackageSubType.FCH,
      srId: packageB.srId,
      srStage: ServiceRequestStage.APPLICATION,
      status: ApplicationPackageStatus.APPLICATION,
    },
  ]);

  const memberA = {
    self: await seedMember(
      models,
      packageA.applicationPackageId,
      userA,
      RelationshipToPrimary.Self,
      MemberTypes.Primary,
      userA.userId,
    ),
    spouse: await seedMember(
      models,
      packageA.applicationPackageId,
      { firstName: 'Sam', lastName: 'SPOUSE', dateOfBirth: '1981-05-05' },
      RelationshipToPrimary.Spouse,
      MemberTypes.PrimaryNonApplicant,
      null,
    ),
    partner: await seedMember(
      models,
      packageA.applicationPackageId,
      { firstName: 'Pat', lastName: 'PARTNER', dateOfBirth: '1983-06-06' },
      RelationshipToPrimary.Partner,
      MemberTypes.PrimaryNonApplicant,
      null,
    ),
    commonLaw: await seedMember(
      models,
      packageA.applicationPackageId,
      { firstName: 'Cleo', lastName: 'COMMONLAW', dateOfBirth: '1979-02-02' },
      RelationshipToPrimary.CommonLaw,
      MemberTypes.PrimaryNonApplicant,
      null,
    ),
    child: await seedMember(
      models,
      packageA.applicationPackageId,
      { firstName: 'Casey', lastName: 'CHILD', dateOfBirth: '2012-11-30' },
      RelationshipToPrimary.Child,
      MemberTypes.NonAdult,
      null,
    ),
    linked: await seedMember(
      models,
      packageA.applicationPackageId,
      userM,
      RelationshipToPrimary.Sibling,
      MemberTypes.NonCaregiverAdult,
      userM.userId,
    ),
  };
  const memberB = {
    self: await seedMember(
      models,
      packageB.applicationPackageId,
      userB,
      RelationshipToPrimary.Self,
      MemberTypes.Primary,
      userB.userId,
    ),
  };

  await seedScreeningForms(
    models,
    packageA.applicationPackageId,
    memberA.linked,
  );
  await seedScreeningForms(
    models,
    packageA.applicationPackageId,
    memberA.child,
  );
  await seedScreeningForms(
    models,
    packageA.applicationPackageId,
    memberA.spouse,
  );
  const formA = await seedApplicationForm(
    models,
    packageA.applicationPackageId,
    memberA.self,
  );
  const formB = await seedApplicationForm(
    models,
    packageB.applicationPackageId,
    memberB.self,
  );

  const attachmentA = { attachmentId: uuidv4() };
  const attachmentB = { attachmentId: uuidv4() };
  await models.attachment.create([
    {
      attachmentId: attachmentA.attachmentId,
      applicationPackageId: packageA.applicationPackageId,
      householdMemberId: memberA.self.householdMemberId,
      attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
      fileName: 'medical-alice.pdf',
      fileType: 'pdf',
      fileSize: 4,
      fileData: 'ZGF0YQ==',
      uploadedBy: userA.userId,
    },
    {
      attachmentId: attachmentB.attachmentId,
      applicationPackageId: packageB.applicationPackageId,
      householdMemberId: memberB.self.householdMemberId,
      attachmentType: AttachmentType.MEDICAL_ASSESSMENT,
      fileName: 'medical-bob.pdf',
      fileType: 'pdf',
      fileSize: 4,
      fileData: 'ZGF0YQ==',
      uploadedBy: userB.userId,
    },
  ]);

  const accessCodeA = { code: 'MEMAAA01' };
  const accessCodeB = { code: 'MEMBBB01' };
  await models.screeningAccessCode.create([
    {
      accessCode: accessCodeA.code,
      type: AccessCodeType.SCREENING,
      applicationPackageId: packageA.applicationPackageId,
      householdMemberId: memberA.linked.householdMemberId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isUsed: false,
      attemptCount: 0,
    },
    {
      accessCode: accessCodeB.code,
      type: AccessCodeType.SCREENING,
      applicationPackageId: packageB.applicationPackageId,
      householdMemberId: memberB.self.householdMemberId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      isUsed: false,
      attemptCount: 0,
    },
  ]);

  return {
    userA,
    userB,
    userM,
    packageA,
    packageB,
    memberA,
    memberB,
    formA,
    formB,
    attachmentA,
    attachmentB,
    accessCodeA,
    accessCodeB,
  };
}
