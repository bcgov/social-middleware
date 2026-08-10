import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bull';
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApplicationFormService } from '../services/application-form.service';
import { ApplicationForm } from '../schemas/application-form.schema';
import { FormParameters } from '../schemas/form-parameters.schema';
import { ApplicationPackage } from '../../application-package/schema/application-package.schema';
import { ApplicationFormStatus } from '../enums/application-form-status.enum';
import { ApplicationFormType } from '../enums/application-form-types.enum';
import { AccessCodeService } from '../../household/services/access-code.service';
import { HouseholdService } from '../../household/services/household.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { FormType } from '../enums/form-type.enum';

// chainable Mongoose query helper
function q(val: unknown) {
  const exec = jest.fn().mockResolvedValue(val);
  const lean = jest.fn().mockReturnValue({ exec });
  const sort = jest.fn().mockReturnValue({ lean, exec });
  const select = jest.fn().mockReturnValue({
    lean,
    exec,
    sort: jest.fn().mockReturnValue({ lean, exec }),
  });
  return { exec, lean, sort, select };
}

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const baseForm = {
  _id: 'mongo-id-001',
  applicationFormId: 'form-001',
  applicationPackageId: 'pkg-001',
  userId: 'user-001',
  householdMemberId: 'hm-001',
  type: ApplicationFormType.ABOUTME,
  status: ApplicationFormStatus.NEW,
  isClone: false,
  formData: null,
  userAttachedForm: false,
  siebelAttachmentId: null,
  submittedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseParams = {
  applicationFormId: 'form-001',
  formId: 'CF0040',
  formAccessToken: 'token-abc',
  type: 'New',
  formParameters: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ApplicationFormService', () => {
  let service: ApplicationFormService;
  let applicationFormModel: any;
  let formParametersModel: any;
  let householdService: jest.Mocked<
    Pick<HouseholdService, 'findByUserId' | 'findById' | 'findPrimaryApplicant'>
  >;
  let mockQueue: { add: jest.Mock };
  let mockSave: jest.Mock;

  beforeEach(async () => {
    mockSave = jest.fn().mockResolvedValue(undefined);

    applicationFormModel = jest
      .fn()
      .mockImplementation(() => ({ save: mockSave }));
    applicationFormModel.find = jest.fn();
    applicationFormModel.findOne = jest.fn();
    applicationFormModel.findOneAndUpdate = jest.fn();
    applicationFormModel.findByIdAndDelete = jest.fn();
    applicationFormModel.deleteMany = jest.fn();
    applicationFormModel.updateMany = jest.fn();

    formParametersModel = jest
      .fn()
      .mockImplementation(() => ({ save: mockSave }));
    formParametersModel.find = jest.fn();
    formParametersModel.findOne = jest.fn();
    formParametersModel.deleteMany = jest.fn();

    householdService = {
      findByUserId: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      findPrimaryApplicant: jest.fn().mockResolvedValue(null),
    };

    mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApplicationFormService,
        {
          provide: getModelToken(ApplicationForm.name),
          useValue: applicationFormModel as object,
        },
        {
          provide: getModelToken(FormParameters.name),
          useValue: formParametersModel as object,
        },
        { provide: getModelToken(ApplicationPackage.name), useValue: {} },
        { provide: 'PinoLogger:ApplicationFormService', useValue: mockLogger },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        {
          provide: AccessCodeService,
          useValue: { createAccessCode: jest.fn() },
        },
        { provide: HouseholdService, useValue: householdService },
        {
          provide: NotificationService,
          useValue: { sendFCHAccessCode: jest.fn() },
        },
        {
          provide: getQueueToken('applicationPackageQueue'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<ApplicationFormService>(ApplicationFormService);
    jest.clearAllMocks();
    mockSave.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── updateFormStatus ──────────────────────────────────────────────────────

  describe('updateFormStatus', () => {
    it('calls findOneAndUpdate with correct filter and $set', async () => {
      applicationFormModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(baseForm),
      });

      await service.updateFormStatus(
        'form-001',
        ApplicationFormStatus.COMPLETE,
      );

      expect(applicationFormModel.findOneAndUpdate).toHaveBeenCalledWith(
        { applicationFormId: 'form-001' },
        { $set: { status: ApplicationFormStatus.COMPLETE } },
      );
    });
  });

  // ─── findByPackageAndUser ──────────────────────────────────────────────────

  describe('findByPackageAndUser', () => {
    it('returns forms for the given package and user', async () => {
      applicationFormModel.find.mockReturnValue(q([baseForm]));

      const result = await service.findByPackageAndUser('pkg-001', 'user-001');

      expect(applicationFormModel.find).toHaveBeenCalledWith({
        applicationPackageId: 'pkg-001',
        userId: 'user-001',
      });
      expect(result).toEqual([baseForm]);
    });

    it('returns empty array when no forms found', async () => {
      applicationFormModel.find.mockReturnValue(q([]));

      const result = await service.findByPackageAndUser('pkg-001', 'user-001');

      expect(result).toEqual([]);
    });
  });

  // ─── findAllByApplicationPackageId ────────────────────────────────────────

  describe('findAllByApplicationPackageId', () => {
    it('returns all forms for the package regardless of userId', async () => {
      applicationFormModel.find.mockReturnValue(q([baseForm]));

      const result = await service.findAllByApplicationPackageId('pkg-001');

      expect(applicationFormModel.find).toHaveBeenCalledWith({
        applicationPackageId: 'pkg-001',
      });
      expect(result).toEqual([baseForm]);
    });
  });

  // ─── deleteByApplicationPackageId ─────────────────────────────────────────

  describe('deleteByApplicationPackageId', () => {
    it('deletes all forms for the package', async () => {
      applicationFormModel.deleteMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 2 }),
      });

      await service.deleteByApplicationPackageId('pkg-001');

      expect(applicationFormModel.deleteMany).toHaveBeenCalledWith({
        applicationPackageId: 'pkg-001',
      });
    });
  });

  // ─── findOneById ──────────────────────────────────────────────────────────

  describe('findOneById', () => {
    it('returns the form when found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm));

      expect(await service.findOneById('form-001')).toEqual(baseForm);
    });

    it('returns null when not found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(null));

      expect(await service.findOneById('form-xxx')).toBeNull();
    });
  });

  // ─── findByIdAndUser ──────────────────────────────────────────────────────

  describe('findByIdAndUser', () => {
    it('returns the form when found', async () => {
      applicationFormModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(baseForm),
      });

      expect(await service.findByIdAndUser('form-001', 'user-001')).toEqual(
        baseForm,
      );
    });

    it('returns null on error', async () => {
      applicationFormModel.findOne.mockReturnValue({
        exec: jest.fn().mockRejectedValue(new Error('DB error')),
      });

      expect(await service.findByIdAndUser('form-001', 'user-001')).toBeNull();
    });
  });

  // ─── confirmOwnership ─────────────────────────────────────────────────────

  describe('confirmOwnership', () => {
    it('returns true for direct ownership', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm));

      expect(await service.confirmOwnership('form-001', 'user-001')).toBe(true);
    });

    it('returns true via household membership when direct ownership fails', async () => {
      applicationFormModel.findOne
        .mockReturnValueOnce(q(null))
        .mockReturnValueOnce(q(baseForm));
      householdService.findByUserId.mockResolvedValue([
        { householdMemberId: 'hm-001' } as any,
      ]);

      expect(await service.confirmOwnership('form-001', 'user-001')).toBe(true);
    });

    it('returns false when user has no household members', async () => {
      applicationFormModel.findOne.mockReturnValue(q(null));
      householdService.findByUserId.mockResolvedValue([]);

      expect(await service.confirmOwnership('form-001', 'user-001')).toBe(
        false,
      );
    });

    it('returns false when ownership not found via household', async () => {
      applicationFormModel.findOne
        .mockReturnValueOnce(q(null))
        .mockReturnValueOnce(q(null));
      householdService.findByUserId.mockResolvedValue([
        { householdMemberId: 'hm-001' } as any,
      ]);

      expect(await service.confirmOwnership('form-001', 'user-001')).toBe(
        false,
      );
    });

    it('returns false on unexpected error', async () => {
      applicationFormModel.findOne.mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockRejectedValue(new Error('DB error')),
        }),
      });

      expect(await service.confirmOwnership('form-001', 'user-001')).toBe(
        false,
      );
    });
  });

  // ─── verifyHouseholdMemberAccess ──────────────────────────────────────────

  describe('verifyHouseholdMemberAccess', () => {
    it('returns true when household member belongs to the user', async () => {
      householdService.findById.mockResolvedValue({
        householdMemberId: 'hm-001',
        userId: 'user-001',
      } as any);

      expect(
        await service.verifyHouseholdMemberAccess('hm-001', 'user-001'),
      ).toBe(true);
    });

    it('returns false when household member belongs to a different user', async () => {
      householdService.findById.mockResolvedValue({
        householdMemberId: 'hm-001',
        userId: 'other-user',
      } as any);

      expect(
        await service.verifyHouseholdMemberAccess('hm-001', 'user-001'),
      ).toBe(false);
    });

    it('returns false when household member not found', async () => {
      householdService.findById.mockResolvedValue(null);

      expect(
        await service.verifyHouseholdMemberAccess('hm-001', 'user-001'),
      ).toBe(false);
    });

    it('returns false on unexpected error', async () => {
      householdService.findById.mockRejectedValue(new Error('DB error'));

      expect(
        await service.verifyHouseholdMemberAccess('hm-001', 'user-001'),
      ).toBe(false);
    });
  });

  // ─── getApplicationFormById ───────────────────────────────────────────────

  describe('getApplicationFormById', () => {
    it('returns a DTO with formId from parameters when form is found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm));
      formParametersModel.findOne.mockReturnValue(q(baseParams));

      const result = await service.getApplicationFormById('form-001');

      expect(result).toMatchObject({
        applicationFormId: 'form-001',
        applicationPackageId: 'pkg-001',
        formId: 'CF0040',
        userId: 'user-001',
        type: ApplicationFormType.ABOUTME,
        status: ApplicationFormStatus.NEW,
      });
    });

    it('returns null when form not found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(null));

      expect(await service.getApplicationFormById('form-xxx')).toBeNull();
    });

    it('falls back to empty string for formId when parameters not found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm));
      formParametersModel.findOne.mockReturnValue(q(null));

      const result = await service.getApplicationFormById('form-001');

      expect(result?.formId).toBe('');
    });
  });

  // ─── submitApplicationForm ────────────────────────────────────────────────

  describe('submitApplicationForm', () => {
    const dto = { token: 'token-abc', jsonToSave: 'base64data==' };

    it('saves form data and status for a valid token', async () => {
      formParametersModel.findOne.mockReturnValue(
        q({ applicationFormId: 'form-001' }),
      );
      applicationFormModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(baseForm),
      });

      await service.submitApplicationForm(dto, ApplicationFormStatus.DRAFT);

      expect(applicationFormModel.findOneAndUpdate).toHaveBeenCalledWith(
        { applicationFormId: 'form-001' },
        {
          $set: {
            formData: 'base64data==',
            status: ApplicationFormStatus.DRAFT,
          },
        },
        { new: true },
      );
    });

    it('throws NotFoundException when token is not found', async () => {
      formParametersModel.findOne.mockReturnValue(q(null));

      await expect(
        service.submitApplicationForm(dto, ApplicationFormStatus.DRAFT),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when form is not found after token lookup', async () => {
      formParametersModel.findOne.mockReturnValue(
        q({ applicationFormId: 'form-001' }),
      );
      applicationFormModel.findOneAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.submitApplicationForm(dto, ApplicationFormStatus.DRAFT),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── cloneApplicationForm ─────────────────────────────────────────────────

  describe('cloneApplicationForm', () => {
    it('clones form and parameters, returns a new applicationFormId', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm));
      formParametersModel.findOne.mockReturnValue(q(baseParams));

      const result = await service.cloneApplicationForm('form-001');

      expect(result.applicationFormId).toBeDefined();
      expect(result.applicationFormId).not.toBe('form-001');
      expect(mockSave).toHaveBeenCalledTimes(2);
    });

    it('throws NotFoundException when source form is not found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(null));

      await expect(service.cloneApplicationForm('form-xxx')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when source parameters are not found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm));
      formParametersModel.findOne.mockReturnValue(q(null));

      await expect(service.cloneApplicationForm('form-001')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── cancelApplicationForm ────────────────────────────────────────────────

  describe('cancelApplicationForm', () => {
    it('deletes parameters and the form document for a cloned form', async () => {
      const clonedForm = { ...baseForm, isClone: true };
      applicationFormModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(clonedForm),
      });
      formParametersModel.deleteMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue(undefined),
      });
      applicationFormModel.findByIdAndDelete.mockReturnValue({
        exec: jest.fn().mockResolvedValue(undefined),
      });

      await service.cancelApplicationForm({ applicationFormId: 'form-001' });

      expect(formParametersModel.deleteMany).toHaveBeenCalledWith({
        applicationFormId: 'form-001',
      });
      expect(applicationFormModel.findByIdAndDelete).toHaveBeenCalledWith(
        'mongo-id-001',
      );
    });

    it('throws NotFoundException when form is not found', async () => {
      applicationFormModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.cancelApplicationForm({ applicationFormId: 'form-xxx' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when form is not a clone', async () => {
      applicationFormModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(baseForm), // isClone: false
      });

      await expect(
        service.cancelApplicationForm({ applicationFormId: 'form-001' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── markFormForResubmission ──────────────────────────────────────────────

  describe('markFormForResubmission', () => {
    it('sets status to SUBMITTED and enqueues a resubmit job', async () => {
      applicationFormModel.findOneAndUpdate.mockReturnValue(q(baseForm));

      await service.markFormForResubmission('form-001');

      expect(applicationFormModel.findOneAndUpdate).toHaveBeenCalledWith(
        { applicationFormId: { $eq: 'form-001' } },
        {
          $set: {
            status: ApplicationFormStatus.SUBMITTED,
            submittedAt: expect.any(Date) as unknown,
          },
        },
        { new: true },
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        'resubmit-form',
        { applicationFormId: 'form-001' },
        expect.objectContaining({ jobId: 'resubmit-form-form-001' }),
      );
    });

    it('throws NotFoundException when form is not found', async () => {
      applicationFormModel.findOneAndUpdate.mockReturnValue(q(null));

      await expect(service.markFormForResubmission('form-xxx')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── convertFormDataToXml ─────────────────────────────────────────────────

  describe('convertFormDataToXml', () => {
    it('converts base64-encoded JSON form data to XML', async () => {
      const payload = { data: { firstName: 'Jane', age: 30 } };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      applicationFormModel.findOne.mockReturnValue(
        q({ ...baseForm, formData: encoded }),
      );

      const result = await service.convertFormDataToXml('form-001');

      expect(result).toContain('<?xml');
      expect(result).toContain('<root>');
    });

    it('strips all values from the XML output', async () => {
      const payload = { firstName: 'Jane', nested: { secret: 'keep-out' } };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      applicationFormModel.findOne.mockReturnValue(
        q({ ...baseForm, formData: encoded }),
      );

      const result = await service.convertFormDataToXml('form-001');

      expect(result).not.toContain('Jane');
      expect(result).not.toContain('keep-out');
    });

    it('uses the nested data field when formData has a data wrapper', async () => {
      const payload = { data: { field1: 'value' }, metadata: { ignore: true } };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      applicationFormModel.findOne.mockReturnValue(
        q({ ...baseForm, formData: encoded }),
      );

      const result = await service.convertFormDataToXml('form-001');

      expect(result).toContain('field1');
      expect(result).not.toContain('metadata');
    });

    it('throws InternalServerErrorException when form is not found', async () => {
      applicationFormModel.findOne.mockReturnValue(q(null));

      await expect(service.convertFormDataToXml('form-xxx')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException when formData is null', async () => {
      applicationFormModel.findOne.mockReturnValue(
        q({ ...baseForm, formData: null }),
      );

      await expect(service.convertFormDataToXml('form-001')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });

  // ─── newFormAccessToken ───────────────────────────────────────────────────

  describe('newFormAccessToken', () => {
    type CreatedParams = {
      applicationFormId: string;
      type: FormType;
      formId: string;
      formAccessToken: string;
      formParameters: { formId: string; language: string };
    };

    it('regenerates form parameters from the application form and returns a token', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm)); // type ABOUTME -> CF0040

      const token = await service.newFormAccessToken({
        applicationFormId: 'form-001',
      });

      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      // exactly one FormParameters record is created...
      expect(mockSave).toHaveBeenCalledTimes(1);
      expect(formParametersModel).toHaveBeenCalledTimes(1);

      // ...built from the durable ApplicationForm, with the canonical formId
      const created = (formParametersModel as jest.Mock).mock
        .calls[0][0] as CreatedParams;
      expect(created).toMatchObject({
        applicationFormId: 'form-001',
        type: FormType.New,
        formId: 'CF0040',
        formAccessToken: token,
        formParameters: { formId: 'CF0040', language: 'en' },
      });
    });

    it('derives from the form type and ignores any DTO metadata', async () => {
      applicationFormModel.findOne.mockReturnValue(q(baseForm)); // ABOUTME -> CF0040

      await service.newFormAccessToken({
        applicationFormId: 'form-001',
        type: FormType.Edit,
        formId: 'SHOULD-BE-IGNORED',
        formParameters: { language: 'fr' },
      });

      const created = (formParametersModel as jest.Mock).mock
        .calls[0][0] as CreatedParams;
      expect(created.type).toBe(FormType.New);
      expect(created.formId).toBe('CF0040');
      expect(created.formParameters).toEqual({
        formId: 'CF0040',
        language: 'en',
      });
    });

    it('throws NotFoundException when the application form does not exist', async () => {
      applicationFormModel.findOne.mockReturnValue(q(null));

      await expect(
        service.newFormAccessToken({ applicationFormId: 'missing' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('throws and does not persist when the form type has no formId mapping (stale/renamed label)', async () => {
      applicationFormModel.findOne.mockReturnValue(
        q({ ...baseForm, type: 'Adults in household' }), // legacy label, absent from FormId map
      );

      await expect(
        service.newFormAccessToken({ applicationFormId: 'form-001' }),
      ).rejects.toThrow(InternalServerErrorException);
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  // ─── markUserAttachedForms ────────────────────────────────────────────────

  describe('markUserAttachedForms', () => {
    it('marks all household member forms as attached and complete', async () => {
      applicationFormModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      });

      await service.markUserAttachedForms('hm-001', 'user-001');

      expect(applicationFormModel.updateMany).toHaveBeenCalledWith(
        { householdMemberId: { $eq: 'hm-001' } },
        {
          $set: {
            userAttachedForm: true,
            status: ApplicationFormStatus.COMPLETE,
          },
        },
      );
    });
  });

  // ─── getApplicationFormsByUser ────────────────────────────────────────────

  describe('getApplicationFormsByUser', () => {
    it('returns mapped DTOs for all forms belonging to the user', async () => {
      applicationFormModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([baseForm]),
      });
      formParametersModel.find.mockReturnValue({
        lean: jest
          .fn()
          .mockResolvedValue([
            { applicationFormId: 'form-001', formId: 'CF0040' },
          ]),
      });

      const result = await service.getApplicationFormsByUser('user-001');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        applicationFormId: 'form-001',
        formId: 'CF0040',
        userId: 'user-001',
      });
    });

    it('returns an empty array when user has no forms', async () => {
      applicationFormModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      expect(await service.getApplicationFormsByUser('user-001')).toEqual([]);
    });

    it('applies the type filter when types are provided', async () => {
      applicationFormModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      await service.getApplicationFormsByUser('user-001', [
        ApplicationFormType.ABOUTME,
      ]);

      expect(applicationFormModel.find).toHaveBeenCalledWith(
        { userId: 'user-001', type: { $in: [ApplicationFormType.ABOUTME] } },
        { formData: 0 },
      );
    });

    it('does not add type filter to the query when types array is empty', async () => {
      applicationFormModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      await service.getApplicationFormsByUser('user-001', []);

      expect(applicationFormModel.find).toHaveBeenCalledWith(
        { userId: 'user-001' },
        { formData: 0 },
      );
    });
  });
});
