import { MailDriver } from './interfaces/mail-driver.interface';
import { PostmarkConfig } from '../interfaces';
import { ServerClient } from 'postmark';
import { MailMessage } from '../interfaces/mail.message';
import { Logger } from '@nestjs/common';
import { mailLogName } from '../mail.utils';
import {
  getMailErrorMetadata,
  getMailLogMetadata,
} from '../mail-log-metadata.util';

export class PostmarkDriver implements MailDriver {
  private readonly logger = new Logger(mailLogName(PostmarkDriver.name));
  private readonly postmarkClient: ServerClient;

  constructor(config: PostmarkConfig) {
    this.postmarkClient = new ServerClient(config.postmarkToken);
  }

  async sendMail(message: MailMessage): Promise<void> {
    try {
      await this.postmarkClient.sendEmail({
        From: message.from,
        To: message.to,
        Subject: message.subject,
        TextBody: message.text,
        HtmlBody: message.html,
      });
      this.logger.debug({
        event: 'mail_sent',
        driver: 'postmark',
        ...getMailLogMetadata(message),
      });
    } catch (err) {
      this.logger.warn({
        event: 'mail_send_failed',
        driver: 'postmark',
        ...getMailLogMetadata(message),
        ...getMailErrorMetadata(err),
      });
      throw err;
    }
  }
}
