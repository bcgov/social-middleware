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
  ) {
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173';
  }

  private readonly frontendUrl: string;

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
      subject: 'Thank you for your interest in becoming a foster caregiver',
      body: `
        <h2>Information Session Request Submitted</h2>
        <p>Hello ${applicantName},</p>
        <p>Thank you for your interest in becoming a foster caregiver. We have received your request for an information session.</p>
        <p>Our team will review your request and contact you to schedule a session.</p>
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
      subject: 'Continue your caregiver application',
      body: `
        <h2>Foster Caregiver Application Ready to Continue</h2>
        <p>Hello ${applicantName},</p>
        <p>You may now complete your foster caregiver application through the <a href="${this.frontendUrl}">Foster & Care Provider Portal</a>.</p>
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
          <h2>You’ve been identified as a household member for a caregiver application</h2>
          <p>Hello ${householdMemberName},</p>
          <p>You have been identified as a household member on an application to become a foster caregiver. As part of the assessment process, the Ministry of Children and Family Development requires all adult household members to provide background information and consent to screening activities.</p>
          <p>Please sign in to the <a href="${this.frontendUrl}">Foster & Care Provider Portal</a> using your BC Services Card and enter the access code <b>${accessCode}</b> to begin.</p>
          <p>Thank you for providing the information we need to continue your assessment.</p> 
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
            <p>${householdMemberName} has provided their screening and consent information via the Foster & Care Provider Portal.</p>
            <p>Once all household members have provided their information, your application will be forwarded along for processesing. You can track the status of your household members through the <a href="${this.frontendUrl}">Foster & Care Provider Portal</a>.</p>
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
      subject: 'Thank you — your caregiver application has been submitted',
      body: `
              <h2>Application Submitted Successfully</h2>
              <p>Hello ${applicantName},</p>
              <p>Thank you — all required information for your caregiver application has been received, and it has now been submitted to the Ministry of Children and Family Development for processing.</p> 
              <p>A social worker will contact you in the coming weeks if they have any questions. You can now complete your Medical Screening form. Please sign in to the <a href="${this.frontendUrl}">Foster & Care Provider Portal</a> for instructions on providing your medical information.</p>
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
