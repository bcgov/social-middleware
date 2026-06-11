// auth/user.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto, UpdateUserDto } from './dto';

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(createUserDto: CreateUserDto): Promise<User> {
    const createdUser = new this.userModel(createUserDto);
    return createdUser.save();
  }

  async findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByBcServicesCardId(bcServicesCardId: string): Promise<User> {
    const user = await this.userModel
      .findOne({ bc_services_card_id: bcServicesCardId })
      .exec();
    if (!user) {
      throw new NotFoundException(
        `User with BC Services Card ID ${bcServicesCardId} not found`,
      );
    }
    return user;
  }

  async findByEmail(email: string): Promise<User> {
    const user = await this.userModel.findOne({ email }).exec();
    if (!user) {
      throw new NotFoundException(`User with email ${email} not found`);
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<User> {
    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updateUserDto, { new: true })
      .exec();
    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return updatedUser;
  }

  async updateLastLogin(id: string): Promise<User> {
    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, { last_login: new Date() }, { new: true })
      .exec();
    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return updatedUser;
  }

  async remove(id: string): Promise<User> {
    const deletedUser = await this.userModel.findByIdAndDelete(id).exec();
    if (!deletedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return deletedUser;
  }

  async findOrCreate(createUserDto: CreateUserDto): Promise<User> {
    try {
      return await this.findByBcServicesCardId(
        createUserDto.bc_services_card_id,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        return this.create(createUserDto);
      }
      throw error;
    }
  }

  async findCreateOrSync(
    incomingData: CreateUserDto,
  ): Promise<{ user: User; changed: boolean }> {
    let existing: User;
    // look for the user
    try {
      existing = await this.findByBcServicesCardId(
        incomingData.bc_services_card_id,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        // they weren't found, so let's create them
        const created = await this.create(incomingData);
        return { user: created, changed: false };
      }
      throw error;
    }

    // they WERE found, so let's see if anything changed..

    const bcscFields = [
      'first_name',
      'last_name',
      //'email', // email is a bcsc field but they have the power to override it; let's not include this as a diff.
      'dateOfBirth',
      'street_address',
      'city',
      'region',
      'country',
      'postal_code',
    ] as const;

    const diff: Partial<User> = {};
    for (const field of bcscFields) {
      if (incomingData[field] != (existing as any)[field]) {
        (diff as any)[field] = incomingData[field];
      }
    }
    // found no changes, return
    if (Object.keys(diff).length === 0) {
      return { user: existing, changed: false };
    }

    // we found some changes, let's note the date
    diff.bcsc_last_synced = new Date();

    // update the user record with the changes
    //const updated = await this.updateUser((existing as any).id, diff);
    // return the updated user object

    //return { user: updated, changed: true };
    return { user: existing, changed: false };
  }

  async updateUser(id: string, updateData: Partial<User>): Promise<User> {
    const updatedUser = await this.userModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true },
    );

    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return updatedUser;
  }
}
