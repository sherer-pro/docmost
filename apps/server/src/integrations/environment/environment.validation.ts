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
import { parseTrustedProxies } from '../../common/security/trusted-proxy.util';
import {
  AI_STREAM_IDLE_TIMEOUT_MAX_MS,
  AI_STREAM_IDLE_TIMEOUT_MIN_MS,
} from './environment.constants';
import { resolveEnvironmentFileSecrets } from './environment-file-secrets';
import { StartupConfigurationError } from '../../common/errors/startup.errors';

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

  @IsOptional()
  @IsString()
  TRUSTED_PROXIES: string;

  @IsOptional()
  @IsString()
  EMBED_ALLOWED_ORIGINS: string;

  @IsOptional()
  @IsString()
  AI_PROVIDER_ALLOWED_ORIGINS: string;

  @IsOptional()
  @IsString()
  AI_RETRIEVAL_ALLOWED_ORIGINS: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  AI_EXTERNAL_MCP_ENABLED: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  AI_BUILTIN_TOOL_EXTENSIONS_ENABLED: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  AI_ASSISTANT_PROFILES_ENABLED: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  PAGE_TEMPLATES_ENABLED: string;

  @IsOptional()
  @Matches(/^([1-9]|10)$/)
  MAX_PAGE_EMBED_DEPTH: string;

  @IsOptional()
  @IsString()
  AI_MCP_ALLOWED_ORIGINS: string;

  @IsOptional()
  @IsString()
  SSO_ALLOWED_ENDPOINTS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  AI_STREAM_IDLE_TIMEOUT_MS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_API_RATE_LIMIT_PER_MINUTE: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_API_MAX_CONCURRENT: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_API_BULK_MAX_CONCURRENT: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  RAG_SYNC_ENABLED: string;

  @IsOptional()
  @IsString()
  RAG_SYNC_ALLOWED_ORIGINS: string;

  @IsOptional()
  @IsString()
  RAG_SYNC_REDIS_PREFIX: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_POLL_INTERVAL_MS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_DISCOVERY_INTERVAL_MS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_MAX_CONCURRENT_BINDINGS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_MAX_CONCURRENT_DOCUMENTS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_REQUEST_TIMEOUT_MS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_PROCESSING_TIMEOUT_MS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_MAX_ATTACHMENT_BYTES: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_RECONCILE_INTERVAL_MS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  RAG_SYNC_SHUTDOWN_TIMEOUT_MS: string;

  @IsOptional()
  @Matches(/^\d+$/)
  MCP_RATE_LIMIT_PER_MINUTE: string;

  @IsOptional()
  @Matches(/^\d+$/)
  MCP_MAX_CONCURRENT: string;

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
  @IsIn(['auto', 'external'])
  DATABASE_MIGRATION_MODE: string;

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
  @ValidateIf((_obj, value) => value !== '' && value != null)
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  AWS_S3_ENDPOINT: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  AWS_S3_FORCE_PATH_STYLE: string;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== '' && value != null)
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

  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  COLLAB_URL: string;

  @IsNotEmpty()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  COLLAB_INTERNAL_URL: string;

  @IsNotEmpty()
  @MinLength(32)
  @IsNotIn(['REPLACE_WITH_LONG_SECRET'])
  COLLAB_INTERNAL_SECRET: string;

  @IsOptional()
  @Matches(/^\d+$/)
  COLLAB_PORT: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  COLLAB_SHOW_STATS: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  CLOUD: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  COLLAB_DISABLE_REDIS: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  DEBUG_MODE: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  PERFORMANCE_DIAGNOSTICS_ENABLED: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  DEBUG_DB: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  LOG_HTTP: string;

  @IsOptional()
  @ValidateIf((_obj, value) => value !== '' && value != null)
  @IsUrl({ protocols: ['http', 'https'], require_tld: false })
  DRAWIO_URL: string;

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
  @IsString()
  PDF_CHROMIUM_EXECUTABLE_PATH: string;

  @IsOptional()
  @Matches(/^\d+$/)
  PDF_RENDER_TIMEOUT_MS: string;
}

export function validate(config: Record<string, any>) {
  const fileSecretErrors = resolveEnvironmentFileSecrets(config);
  const validatedConfig = plainToInstance(EnvironmentVariables, config);

  const errors = validateSync(validatedConfig);
  const runtimeContractErrors = [
    ...fileSecretErrors,
    ...getRuntimeContractErrors(config),
  ];

  if (errors.length > 0 || runtimeContractErrors.length > 0) {
    const validationErrors = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );
    throw new StartupConfigurationError([
      ...validationErrors,
      ...runtimeContractErrors,
    ]);
  }

  return validatedConfig;
}

function getRuntimeContractErrors(config: Record<string, any>): string[] {
  const errors: string[] = [];
  const nodeEnv = String(config.NODE_ENV || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';
  const isCloud = String(config.CLOUD || 'false').toLowerCase() === 'true';

  const aiStreamIdleTimeoutRaw = config.AI_STREAM_IDLE_TIMEOUT_MS;
  if (
    aiStreamIdleTimeoutRaw !== undefined &&
    aiStreamIdleTimeoutRaw !== null &&
    aiStreamIdleTimeoutRaw !== ''
  ) {
    const aiStreamIdleTimeout = Number(aiStreamIdleTimeoutRaw);
    if (
      !Number.isInteger(aiStreamIdleTimeout) ||
      aiStreamIdleTimeout < AI_STREAM_IDLE_TIMEOUT_MIN_MS ||
      aiStreamIdleTimeout > AI_STREAM_IDLE_TIMEOUT_MAX_MS
    ) {
      errors.push(
        `AI_STREAM_IDLE_TIMEOUT_MS must be an integer between ${AI_STREAM_IDLE_TIMEOUT_MIN_MS} and ${AI_STREAM_IDLE_TIMEOUT_MAX_MS}`,
      );
    }
  }

  if (!isProduction) {
    return errors;
  }

  const appUrl = String(config.APP_URL || '').trim();
  if (!appUrl) {
    errors.push('APP_URL is required when NODE_ENV=production');
  } else {
    try {
      const parsedAppUrl = new URL(appUrl);
      if (isCloud && parsedAppUrl.protocol !== 'https:') {
        errors.push('APP_URL must use https when CLOUD=true');
      }
    } catch {
      errors.push('APP_URL must be a valid URL when NODE_ENV=production');
    }
  }

  if (parseTrustedProxies(config.TRUSTED_PROXIES) === true) {
    errors.push(
      'TRUSTED_PROXIES cannot trust all proxies in production; configure exact proxy IPs/CIDRs',
    );
  }

  const rateLimitStorage = String(
    config.AUTH_RATE_LIMIT_STORAGE || 'memory',
  ).toLowerCase();
  if (rateLimitStorage !== 'redis') {
    errors.push('AUTH_RATE_LIMIT_STORAGE must be redis in production');
  }

  return errors;
}
