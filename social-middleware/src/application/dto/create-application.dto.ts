import { IsNotEmpty, IsObject, IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApplicationTypes } from '../enums/application-types.enum';

export class CreateApplicationDto {
    @ApiProperty({
        description: 'The ID of the form to associate',
        example: 'CF0001',
    })
    @IsString()
    formId!: string;

    @ApiProperty({
        description: 'The user initiating the application',
        example: {
            id: 'user_12345',
            name: 'Jane Doe',
        },
    })
    @IsObject()
    @IsNotEmpty()
    user!: {
        id: string;
        [key: string]: any;
    };

    @ApiProperty({
        description: 'The type of application being created',
        enum: ApplicationTypes,
        example: ApplicationTypes.FosterCaregiver,
        required: false,
    })
    @IsEnum(ApplicationTypes)
    type!: ApplicationTypes;

    @ApiProperty({
        description: 'Form parameters to configure form. It can be empty initially',
        example: {
            allowEdit: true,
            prefillFields: ['name', 'email'],
        },
        required: false,
    })
    @IsObject()
    formParameters!: Record<string, any>;

    @ApiProperty({
        description: 'Optional initial form data',
        example: {
            name: 'Jane Doe',
            age: 34,
        },
        required: false,
    })
    @IsOptional()
    @IsObject()
    formData?: Record<string, any>;
}
