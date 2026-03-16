import {
  IsIn,
  IsNotEmpty,
  IsNotIn,
  Matches,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsISO6391 } from '../../common/validator/is-iso6391';

export class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string;

  @IsOptional()
  @Matches(/^\d+$/)
  PORT: string;

  @IsOptional()
  @IsString()
  HOST: string;

  @IsNotEmpty()
  @IsUrl(
    {
      protocols: ['postgres', 'postgresql'],
      require_tld: false,
      allow_underscores: true,
    },
    { message: 'DATABASE_URL must be a valid postgres connection string' },
  )
  DATABASE_URL: string;

  @IsNotEmpty()
  @IsUrl(
    {
      protocols: ['redis', 'rediss'],
      require_tld: false,
      allow_underscores: true,
    },
    { message: 'REDIS_URL must be a valid redis connection string' },
  )
  REDIS_URL: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  APP_URL: string;

  @IsNotEmpty()
  @MinLength(32)
  @IsNotIn(['REPLACE_WITH_LONG_SECRET'])
  APP_SECRET: string;

  @IsOptional()
  @IsIn(['log', 'smtp', 'postmark'])
  MAIL_DRIVER: string;

  @IsOptional()
  @IsIn(['local', 's3'])
  STORAGE_DRIVER: string;

  @IsOptional()
  @Matches(/^\d+$/)
  DATABASE_MAX_POOL: string;

  @IsOptional()
  @IsString()
  JWT_TOKEN_EXPIRES_IN: string;

  @IsOptional()
  @IsString()
  FILE_UPLOAD_SIZE_LIMIT: string;

  @IsOptional()
  @IsString()
  FILE_IMPORT_SIZE_LIMIT: string;

  @IsOptional()
  @IsString()
  MAIL_FROM_ADDRESS: string;

  @IsOptional()
  @IsString()
  MAIL_FROM_NAME: string;

  @IsOptional()
  @IsString()
  SMTP_HOST: string;

  @IsOptional()
  @Matches(/^\d+$/)
  SMTP_PORT: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  SMTP_SECURE: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  SMTP_IGNORETLS: string;

  @IsOptional()
  @IsString()
  SMTP_USERNAME: string;

  @IsOptional()
  @IsString()
  SMTP_PASSWORD: string;

  @IsOptional()
  @IsString()
  POSTMARK_TOKEN: string;

  @IsOptional()
  @IsString()
  AWS_S3_ACCESS_KEY_ID: string;

  @IsOptional()
  @IsString()
  AWS_S3_SECRET_ACCESS_KEY: string;

  @IsOptional()
  @IsString()
  AWS_S3_REGION: string;

  @IsOptional()
  @IsString()
  AWS_S3_BUCKET: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  AWS_S3_ENDPOINT: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  AWS_S3_FORCE_PATH_STYLE: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  AWS_S3_URL: string;

  @IsOptional()
  @IsIn(['memory', 'redis'])
  AUTH_RATE_LIMIT_STORAGE: string;

  @IsOptional()
  @ValidateIf(
    (obj) =>
      !!obj.WEB_PUSH_VAPID_PRIVATE_KEY ||
      !!obj.WEB_PUSH_SUBJECT ||
      !!obj.WEB_PUSH_VAPID_PUBLIC_KEY,
  )
  @IsNotEmpty()
  @IsNotIn(['VAPID_PUBLIC_KEY'])
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'WEB_PUSH_VAPID_PUBLIC_KEY must be base64url encoded',
  })
  WEB_PUSH_VAPID_PUBLIC_KEY: string;

  @IsOptional()
  @ValidateIf(
    (obj) =>
      !!obj.WEB_PUSH_VAPID_PUBLIC_KEY ||
      !!obj.WEB_PUSH_SUBJECT ||
      !!obj.WEB_PUSH_VAPID_PRIVATE_KEY,
  )
  @IsNotEmpty()
  @IsNotIn(['VAPID_PRIVATE_KEY'])
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'WEB_PUSH_VAPID_PRIVATE_KEY must be base64url encoded',
  })
  WEB_PUSH_VAPID_PRIVATE_KEY: string;

  @IsOptional()
  @ValidateIf(
    (obj) =>
      !!obj.WEB_PUSH_VAPID_PUBLIC_KEY ||
      !!obj.WEB_PUSH_VAPID_PRIVATE_KEY ||
      !!obj.WEB_PUSH_SUBJECT,
  )
  @IsNotEmpty()
  @IsNotIn(['mailto:hello@example.com'])
  @IsString()
  @Matches(/^mailto:.+@.+\..+$/, {
    message: 'WEB_PUSH_SUBJECT must be a valid mailto URL',
  })
  WEB_PUSH_SUBJECT: string;

  @IsOptional()
  @ValidateIf((obj) => obj.COLLAB_URL != '' && obj.COLLAB_URL != null)
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  COLLAB_URL: string;

  @IsOptional()
  @Matches(/^\d+$/)
  COLLAB_PORT: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  COLLAB_SHOW_STATS: string;

  @IsOptional()
  CLOUD: boolean;

  @IsOptional()
  @IsIn(['true', 'false'])
  COLLAB_DISABLE_REDIS: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  DISABLE_TELEMETRY: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  DEBUG_MODE: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  DEBUG_DB: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  LOG_HTTP: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  DRAWIO_URL: string;

  @IsOptional()
  @Matches(/^\d+$/)
  BILLING_TRIAL_DAYS: string;

  @IsOptional()
  @IsString()
  STRIPE_PUBLISHABLE_KEY: string;

  @IsOptional()
  @IsString()
  STRIPE_SECRET_KEY: string;

  @IsOptional()
  @IsString()
  STRIPE_WEBHOOK_SECRET: string;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  POSTHOG_HOST: string;

  @IsOptional()
  @IsString()
  POSTHOG_KEY: string;

  @IsOptional()
  @IsUrl(
    { protocols: [], require_tld: true },
    {
      message:
        'SUBDOMAIN_HOST must be a valid FQDN domain without the http protocol. e.g example.com',
    },
  )
  @ValidateIf((obj) => obj.CLOUD === 'true'.toLowerCase())
  SUBDOMAIN_HOST: string;

  @IsOptional()
  @IsIn(['database', 'typesense'])
  @IsString()
  SEARCH_DRIVER: string;

  @IsOptional()
  @IsUrl(
    {
      protocols: ['http', 'https'],
      require_tld: false,
      allow_underscores: true,
    },
    {
      message:
        'TYPESENSE_URL must be a valid typesense url e.g http://localhost:8108',
    },
  )
  @ValidateIf((obj) => obj.SEARCH_DRIVER === 'typesense')
  TYPESENSE_URL: string;

  @ValidateIf((obj) => obj.SEARCH_DRIVER === 'typesense')
  @IsNotEmpty()
  @IsString()
  TYPESENSE_API_KEY: string;

  @IsOptional()
  @ValidateIf((obj) => obj.SEARCH_DRIVER === 'typesense')
  @IsISO6391()
  @IsString()
  TYPESENSE_LOCALE: string;

  @IsOptional()
  @ValidateIf((obj) => obj.AI_DRIVER)
  @IsIn(['openai', 'openai-compatible', 'gemini', 'ollama'])
  @IsString()
  AI_DRIVER: string;

  @IsOptional()
  @IsString()
  AI_EMBEDDING_MODEL: string;

  @ValidateIf((obj) => obj.AI_EMBEDDING_DIMENSION)
  @IsIn(['768', '1024', '1536', '2000', '3072'])
  @IsString()
  AI_EMBEDDING_DIMENSION: string;

  @ValidateIf((obj) => obj.AI_DRIVER)
  @IsString()
  @IsNotEmpty()
  AI_COMPLETION_MODEL: string;

  @IsOptional()
  @ValidateIf(
    (obj) =>
      obj.AI_DRIVER && ['openai', 'openai-compatible'].includes(obj.AI_DRIVER),
  )
  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY: string;

  @IsOptional()
  @ValidateIf(
    (obj) =>
      obj.AI_DRIVER === 'openai-compatible' ||
      (obj.AI_DRIVER === 'openai' && obj.OPENAI_API_URL),
  )
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  OPENAI_API_URL: string;

  @ValidateIf((obj) => obj.AI_DRIVER && obj.AI_DRIVER === 'gemini')
  @IsString()
  @IsNotEmpty()
  GEMINI_API_KEY: string;

  @ValidateIf((obj) => obj.AI_DRIVER && obj.AI_DRIVER === 'ollama')
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  OLLAMA_API_URL: string;

  @IsOptional()
  @IsString()
  PDF_CHROMIUM_EXECUTABLE_PATH: string;

  @IsOptional()
  @Matches(/^\d+$/)
  PDF_RENDER_TIMEOUT_MS: string;
}

export function validate(config: Record<string, any>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(validatedConfig);

  if (errors.length > 0) {
    console.error(
      'The Environment variables has failed the following validations:',
    );

    errors.map((error) => {
      console.error(JSON.stringify(error.constraints));
    });

    console.error(
      'Please fix the environment variables and try again. Exiting program...',
    );
    process.exit(1);
  }

  return validatedConfig;
}
