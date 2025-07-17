import { IsNotEmpty, IsObject, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
        example: 'Foster Parents',
        required: false,
    })
    @IsString()
    type!: string;

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
}
