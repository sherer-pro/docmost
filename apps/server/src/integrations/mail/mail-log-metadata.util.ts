import { MailMessage } from './interfaces/mail.message';

export interface MailLogMetadata {
  recipientPresent: boolean;
  subjectLength: number;
  textBytes: number;
  htmlBytes: number;
}

export function getMailLogMetadata(message: MailMessage): MailLogMetadata {
  return {
    recipientPresent: Boolean(message.to?.trim()),
    subjectLength: Buffer.byteLength(message.subject ?? '', 'utf8'),
    textBytes: Buffer.byteLength(message.text ?? '', 'utf8'),
    htmlBytes: Buffer.byteLength(message.html ?? '', 'utf8'),
  };
}

export function getMailErrorMetadata(error: unknown): {
  errorName: string;
  errorCode?: string;
} {
  const errorName = error instanceof Error ? error.name : 'UnknownError';
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const errorCode =
    typeof rawCode === 'string' && /^[a-z0-9_-]{1,64}$/i.test(rawCode)
      ? rawCode
      : undefined;

  return { errorName, ...(errorCode ? { errorCode } : {}) };
}
