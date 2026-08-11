import { readFileSync } from 'node:fs';

export const ENVIRONMENT_FILE_SECRET_KEYS = [
  'APP_SECRET',
  'COLLAB_INTERNAL_SECRET',
  'DATABASE_URL',
  'REDIS_URL',
  'AWS_S3_SECRET_ACCESS_KEY',
  'SMTP_PASSWORD',
  'POSTMARK_TOKEN',
  'TYPESENSE_API_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
] as const;

function removeSingleTrailingNewline(value: string): string {
  if (value.endsWith('\r\n')) {
    return value.slice(0, -2);
  }
  if (value.endsWith('\n')) {
    return value.slice(0, -1);
  }
  return value;
}

export function resolveEnvironmentFileSecrets(
  config: Record<string, any>,
): string[] {
  const errors: string[] = [];

  for (const key of ENVIRONMENT_FILE_SECRET_KEYS) {
    const fileKey = `${key}_FILE`;
    const filePath = String(config[fileKey] || '').trim();
    const directValue = config[key];
    const hasDirectValue =
      directValue !== undefined && directValue !== null && directValue !== '';

    if (!filePath) {
      continue;
    }

    if (hasDirectValue) {
      errors.push(`${key} and ${fileKey} cannot be configured together`);
      continue;
    }

    let value: string;
    try {
      value = removeSingleTrailingNewline(readFileSync(filePath, 'utf8'));
    } catch {
      errors.push(`${fileKey} must point to a readable file`);
      continue;
    }

    if (!value) {
      errors.push(`${fileKey} must not be empty`);
      continue;
    }

    config[key] = value;
    process.env[key] = value;
  }

  return errors;
}
