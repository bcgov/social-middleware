import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException } from '@nestjs/common';
import { UserService } from '../user.service';
import { User } from '../schemas/user.schema';
import { CreateUserDto } from '../dto';

const mockUserModel = {
  new: jest.fn(),
  constructor: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
  create: jest.fn(),
  exec: jest.fn(),
};

const baseIncomingData: CreateUserDto = {
  bc_services_card_id: 'did-123',
  first_name: 'Jane',
  last_name: 'Doe',
  dateOfBirth: '1990-01-01',
  email: 'jane@example.com',
  street_address: '123 Main St',
  city: 'Victoria',
  region: 'BC',
  country: 'Canada',
  postal_code: 'V8V 1A1',
};

const baseExistingUser: User = {
  id: 'user-001',
  bc_services_card_id: 'did-123',
  first_name: 'Jane',
  last_name: 'Doe',
  dateOfBirth: '1990-01-01',
  email: 'jane@example.com',
  street_address: '123 Main St',
  city: 'Victoria',
  region: 'BC',
  country: 'Canada',
  postal_code: 'V8V 1A1',
  contact_id: '',
  last_login: new Date(),
  status: 'active',
  bcsc_update_pending: false,
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: getModelToken(User.name), useValue: mockUserModel },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findCreateOrSync', () => {
    let findByBcServicesCardIdSpy: jest.SpyInstance;
    let createSpy: jest.SpyInstance;
    let updateUserSpy: jest.SpyInstance;

    beforeEach(() => {
      findByBcServicesCardIdSpy = jest.spyOn(service, 'findByBcServicesCardId');
      createSpy = jest.spyOn(service, 'create');
      updateUserSpy = jest.spyOn(service, 'updateUser');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('creates a new user when not found and returns changed: false', async () => {
      findByBcServicesCardIdSpy.mockRejectedValue(new NotFoundException());
      createSpy.mockResolvedValue(baseExistingUser);

      const result = await service.findCreateOrSync(baseIncomingData);

      expect(createSpy).toHaveBeenCalledWith(baseIncomingData);
      expect(updateUserSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ user: baseExistingUser, changed: false });
    });

    it('returns changed: false and does not update when no BCSC fields have changed', async () => {
      findByBcServicesCardIdSpy.mockResolvedValue(baseExistingUser);

      const result = await service.findCreateOrSync(baseIncomingData);

      expect(updateUserSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ user: baseExistingUser, changed: false });
    });

    it('updates user and returns changed: true when a BCSC field changes', async () => {
      const outdatedUser = { ...baseExistingUser, last_name: 'Smith' };
      const updatedUser = { ...baseExistingUser, bcsc_last_synced: new Date() };
      findByBcServicesCardIdSpy.mockResolvedValue(outdatedUser);
      updateUserSpy.mockResolvedValue(updatedUser);

      const result = await service.findCreateOrSync(baseIncomingData);

      expect(updateUserSpy).toHaveBeenCalledWith(
        'user-001',
        expect.objectContaining({ last_name: 'Doe' }),
      );
      expect(result).toEqual({ user: updatedUser, changed: true });
    });

    it('includes all changed BCSC fields in the update payload', async () => {
      const outdatedUser = {
        ...baseExistingUser,
        first_name: 'Old',
        city: 'Vancouver',
        postal_code: 'V6B 2K9',
      };
      findByBcServicesCardIdSpy.mockResolvedValue(outdatedUser);
      updateUserSpy.mockResolvedValue(baseExistingUser);

      await service.findCreateOrSync(baseIncomingData);

      expect(updateUserSpy).toHaveBeenCalledWith(
        'user-001',
        expect.objectContaining({
          first_name: 'Jane',
          city: 'Victoria',
          postal_code: 'V8V 1A1',
        }),
      );
    });

    it('sets bcsc_last_synced in the update payload when a change is detected', async () => {
      const outdatedUser = {
        ...baseExistingUser,
        street_address: '999 Old Road',
      };
      findByBcServicesCardIdSpy.mockResolvedValue(outdatedUser);
      updateUserSpy.mockResolvedValue(baseExistingUser);

      await service.findCreateOrSync(baseIncomingData);

      expect(updateUserSpy).toHaveBeenCalledWith(
        'user-001',
        expect.objectContaining({ bcsc_last_synced: expect.any(Date) }),
      );
    });

    it('does not include email in the diff', async () => {
      const outdatedUser = { ...baseExistingUser, email: 'old@example.com' };
      findByBcServicesCardIdSpy.mockResolvedValue(outdatedUser);

      const result = await service.findCreateOrSync(baseIncomingData);

      expect(updateUserSpy).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
    });

    it('does not include home_phone or sex in the diff', async () => {
      const outdatedUser = {
        ...baseExistingUser,
        home_phone: '250-555-1234',
        sex: 'M',
      };
      findByBcServicesCardIdSpy.mockResolvedValue(outdatedUser);

      const result = await service.findCreateOrSync(baseIncomingData);

      expect(updateUserSpy).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
    });

    it('does not include bcsc_last_synced in the diff', async () => {
      const outdatedUser = {
        ...baseExistingUser,
        bcsc_last_synced: new Date('2020-01-01'),
      };
      findByBcServicesCardIdSpy.mockResolvedValue(outdatedUser);

      const result = await service.findCreateOrSync(baseIncomingData);

      expect(updateUserSpy).not.toHaveBeenCalled();
      expect(result.changed).toBe(false);
    });

    it('re-throws unexpected errors from findByBcServicesCardId', async () => {
      findByBcServicesCardIdSpy.mockRejectedValue(
        new Error('DB connection lost'),
      );

      await expect(service.findCreateOrSync(baseIncomingData)).rejects.toThrow(
        'DB connection lost',
      );
      expect(createSpy).not.toHaveBeenCalled();
    });
  });
});
