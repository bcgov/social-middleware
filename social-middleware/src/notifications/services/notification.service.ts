import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ChesService } from './ches.service';

@Injectable()
export class NotificationService {
  constructor(
    private readonly chesService: ChesService,
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
    applicationId: string,
  ): Promise<void> {
    const fromEmail = this.configService.get<string>('CHES_FROM_EMAIL');
    //const portalUrl = this.configService.get<string>('FRONTEND_URL');

    if (!fromEmail) {
      throw new Error(
        'Missing CHES configuration: CHES_FROM_EMAIL is required',
      );
    }

    await this.chesService.sendEmail({
      to: [email],
      from: fromEmail,
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
    });

    this.logger.info(
      { email, applicationId },
      'Application submitted notification sent',
    );
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

    await this.chesService.sendEmail({
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
}
