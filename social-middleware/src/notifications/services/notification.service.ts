import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SendEmailDto } from '../dto/send-email.dto';
import { NotificationQueueService } from '../queue/notification-queue.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly notificationQueueService: NotificationQueueService,
    private readonly configService: ConfigService,
    @InjectPinoLogger(NotificationService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Send application submitted notification
   */
  async sendReferralRequested(
    email: string,
    applicantName: string,
  ): Promise<void> {
    const emailData: SendEmailDto = {
      to: [this.getToEmail(email)],
      from:
        this.configService.get<string>('CHES_FROM_EMAIL') ||
        'noreply@gov.bc.ca',
      subject: 'Information Session Request Submitted Successfully',
      body: `
        <h2>Thank you for your interest</h2>
        <p>Hello ${applicantName},</p>
        <p>Your request for a foster caregiver information session was successfully submitted.</p>
        <p>We will review your request and contact you to schedule a session.</p>
        <p>Thank you,<br>BC Caregiver Registry Team</p>
      `,
      bodyType: 'html',
      priority: 'normal',
    };

    await this.notificationQueueService.sendEmail(emailData);
  }

  /**
   * Send application ready notification
   */
  async sendApplicationReady(
    email: string,
    applicantName: string,
  ): Promise<void> {
    const emailData: SendEmailDto = {
      to: [this.getToEmail(email)],
      from:
        this.configService.get<string>('CHES_FROM_EMAIL') ||
        'noreply@gov.bc.ca',
      subject: 'Your Foster Caregiver Application is Ready',
      body: `
        <h2>Continue your caregiver journey</h2>
        <p>Hello ${applicantName},</p>
        <p>You may now complete your foster caregiver application through the portal.</p>
        <p>Sign in and continue the application from My Tasks.</p>
        <p>Thank you,<br>BC Caregiver Registry Team</p>
      `,
      bodyType: 'html',
      priority: 'normal',
    };

    await this.notificationQueueService.sendEmail(emailData);
  }

  /**
   * Send access code notification to HOUSEHOLD MEMBER
   */
  async sendFCHAccessCode(
    email: string,
    applicantName: string,
    householdMemberName: string,
    accessCode: string,
  ): Promise<void> {
    const emailData: SendEmailDto = {
      to: [this.getToEmail(email)],
      from:
        this.configService.get<string>('CHES_FROM_EMAIL') ||
        'noreply@gov.bc.ca',
      subject: 'Foster Caregiver Screening Request',
      body: `
          <h2>You have been named as a household member on a foster caregiver application</h2>
          <p>Hello ${householdMemberName},</p>
          <p>${applicantName} has identified you as a household member on their application to become a foster caregiver. As part of the assessment process, the Ministry of Children and Family Development requires each adult household member to provide background information and consent to screening activities.</p>
          <p>Sign into the caregiver portal using your BC Services Card and use <b>${accessCode}</b> as the access code to begin the process.</p>
          <p>Thank you,<br>BC Caregiver Registry Team</p>
        `,
      bodyType: 'html',
      priority: 'normal',
    };
    await this.notificationQueueService.sendEmail(emailData);
  }

    /**
   * Send access code notification to HOUSEHOLD MEMBER
   */
    async sendApplicationNotSubmitted(
    email: string,
      applicantName: string,
      householdMemberName: string,
      accessCode: string,
    ): Promise<void> {
      const emailData: SendEmailDto = {
        to: [this.getToEmail(email)],
        from:
          this.configService.get<string>('CHES_FROM_EMAIL') ||
          'noreply@gov.bc.ca',
        subject: 'Foster Caregiver Screening Request',
        body: `
            <h2>You have been named as a household member on a foster caregiver application</h2>
            <p>Hello ${householdMemberName},</p>
            <p>${applicantName} has identified you as a household member on their application to become a foster caregiver. As part of the assessment process, the Ministry of Children and Family Development requires each adult household member to provide background information and consent to screening activities.</p>
            <p>Sign into the caregiver portal using your BC Services Card and use <b>${accessCode}</b> as the access code to begin the process.</p>
            <p>Thank you,<br>BC Caregiver Registry Team</p>
          `,
        bodyType: 'html',
        priority: 'normal',
      };
      await this.notificationQueueService.sendEmail(emailData);
    }

  /**
   * Send custom notification
   */
  async sendCustomEmail(
    to: string | string[],
    subject: string,
    body: string,
    options?: {
      cc?: string[];
      bcc?: string[];
      priority?: 'high' | 'normal' | 'low';
      bodyType?: 'html' | 'text';
    },
  ): Promise<void> {
    const fromEmail = this.configService.get<string>('CHES_FROM_EMAIL');

    if (!fromEmail) {
      throw new Error(
        'Missing CHES configuration: CHES_FROM_EMAIL is required',
      );
    }

    await this.notificationQueueService.sendEmail({
      to: Array.isArray(to) ? to : [to],
      from: fromEmail,
      subject,
      body,
      bodyType: options?.bodyType || 'html',
      cc: options?.cc,
      bcc: options?.bcc,
      priority: options?.priority || 'normal',
    });

    this.logger.info({ to, subject }, 'Custom email sent');
  }

  private getToEmail(email: string) {
    const isLive = this.configService.get<string>('CHES_LIVE') === 'true';
    if (isLive) {
      return email;
    } else {
      return 'Tim.Gunderson@gov.bc.ca'; // send to me if we aren't live with the email service
    }
  }
}
