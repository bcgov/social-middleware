import { getQueueToken } from '@nestjs/bull';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { Server } from 'http';
import * as jwt from 'jsonwebtoken';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';
import { LoggerModule } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';

import { ApplicationFormsController } from 'src/application-form/application-form.controller';
import {
  ApplicationForm,
  ApplicationFormDocument,
  ApplicationFormSchema,
} from 'src/application-form/schemas/application-form.schema';
import {
  FormParameters,
  FormParametersDocument,
  FormParametersSchema,
} from 'src/application-form/schemas/form-parameters.schema';
import { ApplicationFormService } from 'src/application-form/services/application-form.service';
import { ApplicationPackageController } from 'src/application-package/application-package.controller';
import { ApplicationPackageQueueService } from 'src/application-package/queue/application-package-queue.service';
import { IcmStageQueueService } from 'src/application-package/queue/icm-stage-queue.service';
import {
  ApplicationPackage,
  ApplicationPackageDocument,
  ApplicationPackageSchema,
} from 'src/application-package/schema/application-package.schema';
import { ApplicationPackageService } from 'src/application-package/services/application-package.service';
import { ProspectService } from 'src/application-package/services/prospect.service';
import { AttachmentsController } from 'src/attachments/attachments.controller';
import { AttachmentsService } from 'src/attachments/attachments.service';
import {
  Attachment,
  AttachmentDocument,
  AttachmentSchema,
} from 'src/attachments/schemas/attachment.schema';
import { AuthController } from 'src/auth/auth.controller';
import { User, UserDocument, UserSchema } from 'src/auth/schemas/user.schema';
import { TokenBlacklistService } from 'src/auth/services/token-blacklist.service';
import { UserService } from 'src/auth/user.service';
import { SessionUtil } from 'src/common/utils/session.util';
import { UserUtil } from 'src/common/utils/user.util';
import { FormsController } from 'src/forms/forms.controller';
import { FormsService } from 'src/forms/forms.service';
import { HouseholdAccessCodeController } from 'src/household/household-access.controller';
import { HouseholdController } from 'src/household/household.controller';
import {
  HouseholdMembers,
  HouseholdMembersDocument,
  HouseholdMembersSchema,
} from 'src/household/schemas/household-members.schema';
import {
  ScreeningAccessCode,
  ScreeningAccessCodeDocument,
  ScreeningAccessCodeSchema,
} from 'src/household/schemas/screening-access-code.schema';
import { AccessCodeService } from 'src/household/services/access-code.service';
import { HouseholdService } from 'src/household/services/household.service';
import { NotificationQueueService } from 'src/notifications/queue/notification-queue.service';
import { NotificationService } from 'src/notifications/services/notification.service';
import { SiebelApiService } from 'src/siebel/siebel-api.service';

export interface SiebelMock {
  getCaseContacts: jest.Mock;
  getServiceRequests: jest.Mock;
  getContactByBcscId: jest.Mock;
  getServiceRequestsByBcscId: jest.Mock;
  createCaregiverApplicationSR: jest.Mock;
  createServiceRequest: jest.Mock;
  updateServiceRequestStage: jest.Mock;
  updateServiceRequestFields: jest.Mock;
  createAttachment: jest.Mock;
  createFormAttachment: jest.Mock;
  createProspect: jest.Mock;
  createSRNotification: jest.Mock;
  createCaseAttachment: jest.Mock;
  createCaseNotification: jest.Mock;
  getIcmContactById: jest.Mock;
  getIcmServiceRequestById: jest.Mock;
  getOpenResourceCasesByContactId: jest.Mock;
  getActiveCaregiverType: jest.Mock;
  getNewKinshipSRsForProspectiveCaregivers: jest.Mock;
}

export interface AuthorizationModels {
  user: Model<UserDocument>;
  applicationPackage: Model<ApplicationPackageDocument>;
  applicationForm: Model<ApplicationFormDocument>;
  formParameters: Model<FormParametersDocument>;
  householdMember: Model<HouseholdMembersDocument>;
  screeningAccessCode: Model<ScreeningAccessCodeDocument>;
  attachment: Model<AttachmentDocument>;
}

export interface AuthorizationHarness {
  app: INestApplication;
  httpServer: Server;
  models: AuthorizationModels;
  siebel: SiebelMock;
  queues: {
    applicationPackage: { add: jest.Mock; getJobs: jest.Mock };
    icmStage: { add: jest.Mock };
    notification: { add: jest.Mock };
  };
  blacklistedJtis: Set<string>;
  stop: () => Promise<void>;
}

export interface SessionIdentity {
  userId: string;
  sub: string;
  email: string;
  name: string;
}

export function mintSessionCookie(identity: SessionIdentity): {
  cookie: string;
  jti: string;
} {
  const jti = uuidv4();
  const token = jwt.sign(
    {
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      userId: identity.userId,
      jti,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: '4h' },
  );
  return { cookie: `app_session=${token}`, jti };
}

export function mintTamperedSessionCookie(identity: SessionIdentity): string {
  const token = jwt.sign(
    {
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      userId: identity.userId,
      jti: uuidv4(),
    },
    'not-the-real-secret',
    { expiresIn: '4h' },
  );
  return `app_session=${token}`;
}

function buildSiebelMock(): SiebelMock {
  return {
    getCaseContacts: jest.fn(),
    getServiceRequests: jest.fn(),
    getContactByBcscId: jest.fn(),
    getServiceRequestsByBcscId: jest.fn(),
    createCaregiverApplicationSR: jest.fn(),
    createServiceRequest: jest.fn(),
    updateServiceRequestStage: jest.fn(),
    updateServiceRequestFields: jest.fn(),
    createAttachment: jest.fn(),
    createFormAttachment: jest.fn(),
    createProspect: jest.fn(),
    createSRNotification: jest.fn(),
    createCaseAttachment: jest.fn(),
    createCaseNotification: jest.fn(),
    getIcmContactById: jest.fn(),
    getIcmServiceRequestById: jest.fn(),
    getOpenResourceCasesByContactId: jest.fn(),
    getActiveCaregiverType: jest.fn(),
    getNewKinshipSRsForProspectiveCaregivers: jest.fn(),
  };
}

export async function startAuthorizationApp(): Promise<AuthorizationHarness> {
  process.env.JWT_SECRET ??= 'authorization-test-jwt-secret';
  process.env.FRONTEND_URL ??= 'http://localhost:5173';
  process.env.FORM_ACCESS_TOKEN_EXPIRY_MINUTES ??= '30';
  process.env.TEST_RESOURCE_CASE = 'false';

  const mongod = await MongoMemoryServer.create();
  const siebel = buildSiebelMock();
  const queueStubs = {
    applicationPackage: {
      add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
      getJobs: jest.fn().mockResolvedValue([]),
    },
    icmStage: {
      add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
    },
    notification: {
      add: jest.fn().mockResolvedValue({ id: 'test-job-id' }),
    },
  };
  const blacklistedJtis = new Set<string>();
  const fakeBlacklist = {
    isBlacklisted: (jti: string) => Promise.resolve(blacklistedJtis.has(jti)),
    blacklist: (jti: string) => {
      blacklistedJtis.add(jti);
      return Promise.resolve();
    },
  };

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true }),
      MongooseModule.forRoot(mongod.getUri()),
      MongooseModule.forFeature([
        { name: User.name, schema: UserSchema },
        { name: ApplicationPackage.name, schema: ApplicationPackageSchema },
        { name: ApplicationForm.name, schema: ApplicationFormSchema },
        { name: FormParameters.name, schema: FormParametersSchema },
        { name: HouseholdMembers.name, schema: HouseholdMembersSchema },
        { name: ScreeningAccessCode.name, schema: ScreeningAccessCodeSchema },
        { name: Attachment.name, schema: AttachmentSchema },
      ]),
      EventEmitterModule.forRoot(),
      LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }),
    ],
    controllers: [
      ApplicationPackageController,
      ApplicationFormsController,
      FormsController,
      AttachmentsController,
      HouseholdController,
      HouseholdAccessCodeController,
      AuthController,
    ],
    providers: [
      ApplicationPackageService,
      ApplicationFormService,
      ProspectService,
      ApplicationPackageQueueService,
      IcmStageQueueService,
      NotificationService,
      NotificationQueueService,
      AttachmentsService,
      FormsService,
      HouseholdService,
      AccessCodeService,
      UserService,
      SessionUtil,
      UserUtil,
      { provide: SiebelApiService, useValue: siebel },
      { provide: TokenBlacklistService, useValue: fakeBlacklist },
      {
        provide: getQueueToken('applicationPackageQueue'),
        useValue: queueStubs.applicationPackage,
      },
      {
        provide: getQueueToken('icmStageQueue'),
        useValue: queueStubs.icmStage,
      },
      {
        provide: getQueueToken('notificationQueue'),
        useValue: queueStubs.notification,
      },
      { provide: 'AUTH_STRATEGY', useValue: {} },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  await app.init();

  const models: AuthorizationModels = {
    user: moduleRef.get<Model<UserDocument>>(getModelToken(User.name)),
    applicationPackage: moduleRef.get<Model<ApplicationPackageDocument>>(
      getModelToken(ApplicationPackage.name),
    ),
    applicationForm: moduleRef.get<Model<ApplicationFormDocument>>(
      getModelToken(ApplicationForm.name),
    ),
    formParameters: moduleRef.get<Model<FormParametersDocument>>(
      getModelToken(FormParameters.name),
    ),
    householdMember: moduleRef.get<Model<HouseholdMembersDocument>>(
      getModelToken(HouseholdMembers.name),
    ),
    screeningAccessCode: moduleRef.get<Model<ScreeningAccessCodeDocument>>(
      getModelToken(ScreeningAccessCode.name),
    ),
    attachment: moduleRef.get<Model<AttachmentDocument>>(
      getModelToken(Attachment.name),
    ),
  };

  return {
    app,
    httpServer: app.getHttpServer() as Server,
    models,
    siebel,
    queues: queueStubs,
    blacklistedJtis,
    stop: async () => {
      await app.close();
      await mongod.stop();
    },
  };
}
