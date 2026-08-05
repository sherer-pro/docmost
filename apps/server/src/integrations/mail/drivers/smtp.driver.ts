import { MailDriver } from './interfaces/mail-driver.interface';
import { SMTPConfig } from '../interfaces';
import { Transporter } from 'nodemailer';
import * as nodemailer from 'nodemailer';
import { MailMessage } from '../interfaces/mail.message';
import { Logger } from '@nestjs/common';
import { mailLogName } from '../mail.utils';
import {
  getMailErrorMetadata,
  getMailLogMetadata,
} from '../mail-log-metadata.util';

export class SmtpDriver implements MailDriver {
  private readonly logger = new Logger(mailLogName(SmtpDriver.name));
  private readonly transporter: Transporter;

  constructor(config: SMTPConfig) {
    this.transporter = nodemailer.createTransport(config);
  }

  async sendMail(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      this.logger.debug({
        event: 'mail_sent',
        driver: 'smtp',
        ...getMailLogMetadata(message),
      });
    } catch (err) {
      this.logger.warn({
        event: 'mail_send_failed',
        driver: 'smtp',
        ...getMailLogMetadata(message),
        ...getMailErrorMetadata(err),
      });
      throw err;
    }
  }
}
