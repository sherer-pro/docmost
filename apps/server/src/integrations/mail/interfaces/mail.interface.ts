import type { SMTPTransportOptions } from 'nodemailer/lib/smtp-transport';

export enum MailOption {
  SMTP = 'smtp',
  Postmark = 'postmark',
  Log = 'log',
}

export type MailConfig =
  | { driver: MailOption.SMTP; config: SMTPConfig }
  | { driver: MailOption.Postmark; config: PostmarkConfig }
  | { driver: MailOption.Log; config: LogConfig };

export interface SMTPConfig extends SMTPTransportOptions {}
export interface PostmarkConfig {
  postmarkToken: string;
}
export interface LogConfig {}

export interface MailOptions {
  mail: MailConfig;
}

export interface MailOptionsFactory {
  createMailOptions(): Promise<MailConfig> | MailConfig;
}

export interface MailModuleOptions {
  imports?: any[];
}
