import { MailDriver } from './interfaces/mail-driver.interface';
import { Logger } from '@nestjs/common';
import { MailMessage } from '../interfaces/mail.message';
import { mailLogName } from '../mail.utils';
import * as process from 'node:process';
import { getMailLogMetadata } from '../mail-log-metadata.util';

export class LogDriver implements MailDriver {
  private readonly logger = new Logger(mailLogName(LogDriver.name));
  private readonly disabledInProduction =
    process.env.NODE_ENV?.toLowerCase() === 'production';

  constructor() {
    if (this.disabledInProduction) {
      this.logger.warn({
        event: 'mail_delivery_disabled',
        driver: 'log',
      });
    }
  }

  async sendMail(message: MailMessage): Promise<void> {
    if (this.disabledInProduction) {
      return;
    }

    this.logger.log({
      event: 'mail_preview_suppressed',
      driver: 'log',
      ...getMailLogMetadata(message),
    });
  }
}
