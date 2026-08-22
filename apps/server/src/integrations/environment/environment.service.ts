import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ms, { StringValue } from 'ms';
import {
  parseTrustedProxies,
  TrustedProxyConfig,
} from '../../common/security/trusted-proxy.util';
import {
  AI_STREAM_IDLE_TIMEOUT_DEFAULT_MS,
  AI_STREAM_IDLE_TIMEOUT_MAX_MS,
  AI_STREAM_IDLE_TIMEOUT_MIN_MS,
} from './environment.constants';

@Injectable()
export class EnvironmentService {
  constructor(private configService: ConfigService) {}

  getNodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  isDevelopment(): boolean {
    return this.getNodeEnv() === 'development';
  }

  getAppUrl(): string {
    const rawUrl =
      this.configService.get<string>('APP_URL') ||
      `http://localhost:${this.getPort()}`;

    const { origin } = new URL(rawUrl);
    return origin;
  }

  isHttps(): boolean {
    const appUrl = this.configService.get<string>('APP_URL');
    try {
      const url = new URL(appUrl);
      return url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  getSubdomainHost(): string {
    return this.configService.get<string>('SUBDOMAIN_HOST');
  }

  getPort(): number {
    return parseInt(this.configService.get<string>('PORT', '3000'));
  }

  getHost(): string {
    return this.configService.get<string>('HOST', '0.0.0.0');
  }

  getTrustedProxies(): TrustedProxyConfig {
    return parseTrustedProxies(
      this.configService.get<string>('TRUSTED_PROXIES', ''),
    );
  }

  getEmbedAllowedOrigins(): string {
    return this.configService.get<string>('EMBED_ALLOWED_ORIGINS', '');
  }

  getAiProviderAllowedOrigins(): string {
    return this.configService.get<string>('AI_PROVIDER_ALLOWED_ORIGINS', '');
  }

  getAiRetrievalAllowedOrigins(): string {
    return this.configService.get<string>('AI_RETRIEVAL_ALLOWED_ORIGINS', '');
  }

  isAiExternalMcpEnabled(): boolean {
    return (
      this.configService
        .get<string>('AI_EXTERNAL_MCP_ENABLED', 'false')
        .toLowerCase() === 'true'
    );
  }

  isAiBuiltinToolExtensionsEnabled(): boolean {
    return (
      this.configService
        .get<string>('AI_BUILTIN_TOOL_EXTENSIONS_ENABLED', 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  isAiAssistantProfilesEnabled(): boolean {
    return (
      this.configService
        .get<string>('AI_ASSISTANT_PROFILES_ENABLED', 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  isPageTemplatesEnabled(): boolean {
    return (
      this.configService
        .get<string>('PAGE_TEMPLATES_ENABLED', 'false')
        .trim()
        .toLowerCase() === 'true'
    );
  }

  getAiMcpAllowedOrigins(): string {
    return this.configService.get<string>('AI_MCP_ALLOWED_ORIGINS', '');
  }

  getSsoAllowedEndpoints(): string {
    return this.configService.get<string>('SSO_ALLOWED_ENDPOINTS', '');
  }

  getAiStreamIdleTimeoutMs(): number {
    const rawTimeout = this.configService.get<string | number>(
      'AI_STREAM_IDLE_TIMEOUT_MS',
      AI_STREAM_IDLE_TIMEOUT_DEFAULT_MS,
    );
    const timeout = Number(rawTimeout);

    if (
      !Number.isInteger(timeout) ||
      timeout < AI_STREAM_IDLE_TIMEOUT_MIN_MS ||
      timeout > AI_STREAM_IDLE_TIMEOUT_MAX_MS
    ) {
      return AI_STREAM_IDLE_TIMEOUT_DEFAULT_MS;
    }

    return timeout;
  }

  getAppSecret(): string {
    return this.configService.get<string>('APP_SECRET');
  }

  getDatabaseURL(): string {
    return this.configService.get<string>('DATABASE_URL');
  }

  getDatabaseMaxPool(): number {
    return parseInt(this.configService.get<string>('DATABASE_MAX_POOL', '10'));
  }

  getDatabaseMigrationMode(): 'auto' | 'external' {
    return this.configService.get<string>('DATABASE_MIGRATION_MODE', 'auto') ===
      'external'
      ? 'external'
      : 'auto';
  }

  getRedisUrl(): string {
    return this.configService.get<string>(
      'REDIS_URL',
      'redis://localhost:6379',
    );
  }

  getAuthRateLimitStorage(): 'memory' | 'redis' {
    const storage = this.configService
      .get<string>('AUTH_RATE_LIMIT_STORAGE', 'memory')
      .toLowerCase();

    return storage === 'redis' ? 'redis' : 'memory';
  }

  getRagApiTrafficLimits() {
    return {
      ratePerMinute: this.getRagApiRateLimitPerMinute(),
      maxConcurrent: this.getRagApiMaxConcurrent(),
      maxBulkConcurrent: this.getRagApiBulkMaxConcurrent(),
    };
  }

  getMcpTrafficLimits() {
    return {
      ratePerMinute: this.getMcpRateLimitPerMinute(),
      maxConcurrent: this.getMcpMaxConcurrent(),
    };
  }

  getRagApiRateLimitPerMinute(): number {
    return this.normalizePositiveInteger(
      this.configService.get<string | number>(
        'RAG_API_RATE_LIMIT_PER_MINUTE',
        120,
      ),
      120,
    );
  }

  getRagApiMaxConcurrent(): number {
    return this.normalizePositiveInteger(
      this.configService.get<string | number>('RAG_API_MAX_CONCURRENT', 8),
      8,
    );
  }

  getRagApiBulkMaxConcurrent(): number {
    return this.normalizePositiveInteger(
      this.configService.get<string | number>('RAG_API_BULK_MAX_CONCURRENT', 2),
      2,
    );
  }

  getMcpRateLimitPerMinute(): number {
    return this.normalizePositiveInteger(
      this.configService.get<string | number>('MCP_RATE_LIMIT_PER_MINUTE', 60),
      60,
    );
  }

  getMcpMaxConcurrent(): number {
    return this.normalizePositiveInteger(
      this.configService.get<string | number>('MCP_MAX_CONCURRENT', 4),
      4,
    );
  }

  private normalizePositiveInteger(
    rawValue: string | number | undefined,
    fallback: number,
  ): number {
    const value = Number(rawValue);
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  getJwtTokenExpiresIn(): string {
    return this.configService.get<string>('JWT_TOKEN_EXPIRES_IN', '30d');
  }

  getCookieExpiresIn(): Date {
    const expiresInStr = this.getJwtTokenExpiresIn();
    let msUntilExpiry: number;
    try {
      msUntilExpiry = ms(expiresInStr as StringValue);
    } catch (err) {
      msUntilExpiry = ms('30d');
    }
    return new Date(Date.now() + msUntilExpiry);
  }

  getStorageDriver(): string {
    return this.configService.get<string>('STORAGE_DRIVER', 'local');
  }

  getFileUploadSizeLimit(): string {
    return this.configService.get<string>('FILE_UPLOAD_SIZE_LIMIT', '50mb');
  }

  getFileImportSizeLimit(): string {
    return this.configService.get<string>('FILE_IMPORT_SIZE_LIMIT', '200mb');
  }

  getAwsS3AccessKeyId(): string {
    return this.configService.get<string>('AWS_S3_ACCESS_KEY_ID');
  }

  getAwsS3SecretAccessKey(): string {
    return this.configService.get<string>('AWS_S3_SECRET_ACCESS_KEY');
  }

  getAwsS3Region(): string {
    return this.configService.get<string>('AWS_S3_REGION');
  }

  getAwsS3Bucket(): string {
    return this.configService.get<string>('AWS_S3_BUCKET');
  }

  getAwsS3Endpoint(): string {
    return this.configService.get<string>('AWS_S3_ENDPOINT');
  }

  getAwsS3ForcePathStyle(): boolean {
    const forcePathStyle = this.configService
      .get<string>('AWS_S3_FORCE_PATH_STYLE', 'false')
      .toLowerCase();
    return forcePathStyle === 'true';
  }

  getAwsS3Url(): string {
    return this.configService.get<string>('AWS_S3_URL');
  }

  getMailDriver(): string {
    return this.configService.get<string>('MAIL_DRIVER', 'log');
  }

  getMailFromAddress(): string {
    return this.configService.get<string>('MAIL_FROM_ADDRESS');
  }

  getMailFromName(): string {
    return this.configService.get<string>('MAIL_FROM_NAME', 'Docmost');
  }

  getSmtpHost(): string {
    return this.configService.get<string>('SMTP_HOST');
  }

  getSmtpPort(): number {
    return parseInt(this.configService.get<string>('SMTP_PORT'));
  }

  getSmtpSecure(): boolean {
    const secure = this.configService
      .get<string>('SMTP_SECURE', 'false')
      .toLowerCase();
    return secure === 'true';
  }

  getSmtpIgnoreTLS(): boolean {
    const ignoretls = this.configService
      .get<string>('SMTP_IGNORETLS', 'false')
      .toLowerCase();
    return ignoretls === 'true';
  }

  getSmtpUsername(): string {
    return this.configService.get<string>('SMTP_USERNAME');
  }

  getSmtpPassword(): string {
    return this.configService.get<string>('SMTP_PASSWORD');
  }

  getPostmarkToken(): string {
    return this.configService.get<string>('POSTMARK_TOKEN');
  }

  getWebPushVapidPublicKey(): string {
    return this.configService.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
  }

  getWebPushVapidPrivateKey(): string {
    return this.configService.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
  }

  getWebPushSubject(): string {
    return this.configService.get<string>('WEB_PUSH_SUBJECT');
  }

  getDrawioUrl(): string {
    return this.configService.get<string>('DRAWIO_URL');
  }

  isCloud(): boolean {
    const cloudConfig = this.configService
      .get<string>('CLOUD', 'false')
      .toLowerCase();
    return cloudConfig === 'true';
  }

  isSelfHosted(): boolean {
    return !this.isCloud();
  }

  getCollabUrl(): string {
    return this.configService.get<string>('COLLAB_URL');
  }

  getCollabInternalUrl(): string {
    return this.configService.get<string>('COLLAB_INTERNAL_URL');
  }

  getCollabInternalSecret(): string {
    return this.configService.get<string>('COLLAB_INTERNAL_SECRET');
  }

  getCollabPort(): number {
    return parseInt(this.configService.get<string>('COLLAB_PORT', '3001'));
  }

  isCollabShowStatsEnabled(): boolean {
    const showStats = this.configService
      .get<string>('COLLAB_SHOW_STATS', 'false')
      .toLowerCase();
    return showStats === 'true';
  }

  isCollabDisableRedis(): boolean {
    const isStandalone = this.configService
      .get<string>('COLLAB_DISABLE_REDIS', 'false')
      .toLowerCase();
    return isStandalone === 'true';
  }

  isDebugMode(): boolean {
    const debugMode = this.configService
      .get<string>('DEBUG_MODE', 'false')
      .toLowerCase();
    return debugMode === 'true';
  }

  isPerformanceDiagnosticsEnabled(): boolean {
    const enabled = this.configService
      .get<string>('PERFORMANCE_DIAGNOSTICS_ENABLED', 'false')
      .toLowerCase();
    return enabled === 'true';
  }

  isDebugDbEnabled(): boolean {
    const debugDb = this.configService
      .get<string>('DEBUG_DB', 'false')
      .toLowerCase();
    return debugDb === 'true';
  }

  isHttpLoggingEnabled(): boolean {
    const logHttp = this.configService
      .get<string>('LOG_HTTP', 'false')
      .toLowerCase();
    return logHttp === 'true';
  }

  getSearchDriver(): string {
    return this.configService
      .get<string>('SEARCH_DRIVER', 'database')
      .toLowerCase();
  }

  getTypesenseUrl(): string {
    return this.configService
      .get<string>('TYPESENSE_URL', 'http://localhost:8108')
      .trim();
  }

  getTypesenseApiKey(): string {
    return this.configService.get<string>('TYPESENSE_API_KEY');
  }

  getTypesenseLocale(): string {
    return this.configService
      .get<string>('TYPESENSE_LOCALE', 'en')
      .toLowerCase();
  }

  getPdfChromiumExecutablePath(): string | undefined {
    const executablePath = this.configService.get<string>(
      'PDF_CHROMIUM_EXECUTABLE_PATH',
    );
    const normalizedPath = executablePath?.trim();

    return normalizedPath ? normalizedPath : undefined;
  }

  getPdfRenderTimeoutMs(): number {
    const timeoutRaw = this.configService.get<string>(
      'PDF_RENDER_TIMEOUT_MS',
      '60000',
    );
    const timeoutValue = parseInt(timeoutRaw, 10);

    if (!Number.isFinite(timeoutValue) || timeoutValue <= 0) {
      return 60000;
    }

    return timeoutValue;
  }
}
