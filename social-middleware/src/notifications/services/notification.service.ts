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
   * When a household member submits their screening info through the portal, trigger an email to the applicant to let them know.
   */
  async sendApplicationNotSubmitted(
    email: string,
    applicantName: string,
    householdMemberName: string,
  ): Promise<void> {
    const emailData: SendEmailDto = {
      to: [this.getToEmail(email)],
      from:
        this.configService.get<string>('CHES_FROM_EMAIL') ||
        'noreply@gov.bc.ca',
      subject: 'Household Consent Provided',
      body: `
            <h2>A household member has provided their screening information</h2>
            <p>Hello ${applicantName},</p>
            <p>${householdMemberName} has provided their screening and consent information via the caregiver portal.</p>
            <p>Once all household members have provided their information, your application will be forwarded along for processesing. You can track the status of your household members through the caregiver portal.</p>
            <p>Thank you,<br>BC Caregiver Registry Team</p>
          `,
      bodyType: 'html',
      priority: 'normal',
    };
    await this.notificationQueueService.sendEmail(emailData);
  }

  /**
   * When all applicable consent/screening records have been provided, notify the applicant that their application has been sent to MCFD
   */
  async sendApplicationSubmitted(
    email: string,
    applicantName: string,
  ): Promise<void> {
    const emailData: SendEmailDto = {
      to: [this.getToEmail(email)],
      from:
        this.configService.get<string>('CHES_FROM_EMAIL') ||
        'noreply@gov.bc.ca',
      subject: 'Foster caregiver application submitted to MCFD',
      body: `
              <h2>Your foster caregiver application has been submitted</h2>
              <p>Hello ${applicantName},</p>
              <p>All outstanding information has been provided for your caregiver application. It has been submitted to the Ministry of Child and Family Development for processing.</p> 
              <p>Social workers will be in touch in the coming weeks about any outstanding questions they may have. You may proceed to complete your Medical Screening form. Please log into the caregiver portal for information on providing your Medical Screening information.</p>
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
