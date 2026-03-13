import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Req,
  HttpException,
  HttpStatus,
  ValidationPipe,
  ParseUUIDPipe,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { Request } from 'express';
import { AttachmentsService } from './attachments.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { GetAttachmentDto } from './dto/get-attachment.dto';
import { SessionUtil } from '../common/utils/session.util';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { HouseholdService } from '../household/services/household.service';

@ApiBearerAuth()
@ApiTags('Attachments')
@Controller('attachments')
@UseGuards(SessionAuthGuard)
export class AttachmentsController {
  constructor(
    private readonly attachmentsService: AttachmentsService,
    private readonly sessionUtil: SessionUtil,
    private readonly householdService: HouseholdService, // used to validate ownership
  ) {}

  @Post()
  @ApiOperation({ summary: 'Upload a new attachment' })
  @ApiBody({ type: CreateAttachmentDto })
  @ApiResponse({
    status: 201,
    description: 'Attachment uploaded successfully',
  })
  async uploadAttachment(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: CreateAttachmentDto,
    @Req() request: Request,
  ) {
    try {
      const userId = this.sessionUtil.extractUserIdFromRequest(request);
      return await this.attachmentsService.create(dto, userId);
    } catch (error) {
      throw new HttpException(
        'Failed to upload attachment',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('application-package/:applicationPackageId')
  @ApiOperation({ summary: 'Get attachments by application package ID' })
  @ApiParam({ name: 'applicationPackageId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Attachments retrieved successfully',
    type: [GetAttachmentDto],
  })
  async getByApplicationPackage(
    @Param('applicationPackageId', new ParseUUIDPipe())
    applicationPackageId: string,
    @Req() request: Request,
  ): Promise<GetAttachmentDto[]> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    return await this.attachmentsService.findByApplicationPackageId(
      applicationPackageId,
      userId,
    );
  }

  @Get('/household-member/:householdMemberId')
  @ApiOperation({ summary: 'Get attachments by householdMember ID' })
  @ApiParam({ name: 'householdMemberId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Attachments retrieved successfully',
    type: [GetAttachmentDto],
  })
  async getByApplicationPackageAndHouseholdMemberId(
    @Param('householdMemberId', new ParseUUIDPipe()) householdMemberId: string,
    @Req() request: Request,
  ): Promise<GetAttachmentDto[]> {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const owns =
      await this.householdService.verifyUserOwnsHouseholdMemberPackage(
        householdMemberId,
        userId,
      );
    if (!owns) {
      throw new ForbiddenException();
    }
    return await this.attachmentsService.findByHouseholdMemberId(
      householdMemberId,
    );
  }

  /* not required for now
  @Get('household-member/:householdMemberId')
  @ApiOperation({ summary: 'Get attachments by household member ID' })
  @ApiParam({ name: 'householdMemberId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Attachments retrieved successfully',
    type: [GetAttachmentDto],
  })
  async getByHouseholdMember(
    @Param('householdMemberId') householdMemberId: string,
  ): Promise<GetAttachmentDto[]> {
    return await this.attachmentsService.findByHouseholdMemberId(
      householdMemberId,
    );
  }
 */

  @Get(':attachmentId')
  @ApiOperation({ summary: 'Download attachment by ID' })
  @ApiParam({ name: 'attachmentId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Attachment retrieved successfully',
  })
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @Req() request: Request,
  ) {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    const attachment = await this.attachmentsService.findByIdAndUser(
      attachmentId,
      userId,
    );
    if (!attachment) {
      throw new HttpException('Attachment not found', HttpStatus.NOT_FOUND);
    }
    return attachment;
  }

  // note, that you can only delete an attachment you own.
  @Delete(':attachmentId')
  @ApiOperation({ summary: 'Delete attachment by ID' })
  @ApiParam({ name: 'attachmentId', type: String })
  @ApiResponse({
    status: 200,
    description: 'Attachment deleted successfully',
  })
  async deleteAttachment(
    @Param('attachmentId') attachmentId: string,
    @Req() request: Request,
  ) {
    const userId = this.sessionUtil.extractUserIdFromRequest(request);
    await this.attachmentsService.delete(attachmentId, userId);
    return { success: true, message: 'Attachment deleted successfully' };
  }
}
