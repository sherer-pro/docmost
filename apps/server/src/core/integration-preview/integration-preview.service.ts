import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { createHmac, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { KyselyDB } from '@docmost/db/types/kysely.types';
import type { User } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import {
  INTEGRATION_PREVIEW_PROVIDERS,
  type IntegrationPreviewProvider,
  type IntegrationPreviewResult,
} from '@docmost/api-contract';
import { parseIntegrationPreviewUrl } from '@docmost/editor-ext/server';
import { PageAccessService } from '../page-access/page-access.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  encryptProtectedValue,
  decryptProtectedValue,
  isEncryptedProtectedValue,
} from '../../common/security/credential-protection.util';
import { IntegrationPreviewHttpService } from './integration-preview-http.service';

const safeText = (value: unknown, limit: number) =>
  typeof value === 'string'
    ? value
        .replace(/[\p{Cc}]/gu, ' ')
        .slice(0, limit)
        .trim()
    : '';
type CacheEntry = {
  expiresAt: number;
  etag: string | null;
  result: IntegrationPreviewResult;
};

@Injectable()
export class IntegrationPreviewService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly activeByUser = new Map<string, number>();
  private activeTotal = 0;
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environment: EnvironmentService,
    private readonly http: IntegrationPreviewHttpService,
    private readonly pages: PageRepo,
    private readonly access: PageAccessService,
  ) {}

  async settings(workspaceId: string) {
    return {
      enabled:
        (
          await this.db
            .selectFrom('integrationPreviewSettings')
            .select('enabled')
            .where('workspaceId', '=', workspaceId)
            .executeTakeFirst()
        )?.enabled ?? false,
      availableProviders: this.http.availableProviders(),
    };
  }

  async updateSettings(user: User, enabled: unknown) {
    if (!['owner', 'admin'].includes(user.role))
      throw new ForbiddenException('Workspace administrator required');
    if (typeof enabled !== 'boolean')
      throw new BadRequestException('Enabled must be a boolean');
    await this.db
      .insertInto('integrationPreviewSettings')
      .values({ workspaceId: user.workspaceId, enabled })
      .onConflict((oc) =>
        oc
          .column('workspaceId')
          .doUpdateSet({ enabled, updatedAt: new Date() }),
      )
      .execute();
    this.cache.clear();
    return this.settings(user.workspaceId);
  }

  async connections(user: User) {
    return this.db
      .selectFrom('integrationPreviewConnections')
      .select(['id', 'provider', 'updatedAt', 'lastUsedAt'])
      .where('workspaceId', '=', user.workspaceId)
      .where('userId', '=', user.id)
      .orderBy('provider')
      .execute();
  }

  async saveConnection(user: User, value: unknown, credential: unknown) {
    const provider = this.provider(value);
    if (
      typeof credential !== 'string' ||
      !credential.trim() ||
      credential.length > 4096 ||
      /[\p{Cc}\p{Cf}]/u.test(credential)
    )
      throw new BadRequestException('Invalid integration credential');
    const settings = await this.settings(user.workspaceId);
    if (!settings.enabled || !settings.availableProviders.includes(provider))
      throw new ConflictException(
        'Integration previews are not enabled for this provider',
      );
    const connection = await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${this.lockKey(user, provider)}, 0))`.execute(
        trx,
      );
      const old = await trx
        .selectFrom('integrationPreviewConnections')
        .select('id')
        .where('workspaceId', '=', user.workspaceId)
        .where('userId', '=', user.id)
        .where('provider', '=', provider)
        .executeTakeFirst();
      const id = old?.id ?? randomUUID();
      const encrypted = encryptProtectedValue(
        credential.trim(),
        this.credentialKey(user, id),
      );
      return trx
        .insertInto('integrationPreviewConnections')
        .values({
          id,
          workspaceId: user.workspaceId,
          userId: user.id,
          provider,
          credential: encrypted,
          lastUsedAt: null,
        })
        .onConflict((oc) =>
          oc.columns(['workspaceId', 'userId', 'provider']).doUpdateSet({
            credential: encrypted,
            revision: sql<number>`integration_preview_connections.revision + 1`,
            updatedAt: new Date(),
            lastUsedAt: null,
          }),
        )
        .returning(['id', 'provider', 'updatedAt', 'lastUsedAt'])
        .executeTakeFirstOrThrow();
    });
    this.clearUserCache(user);
    return connection;
  }

  async removeConnection(user: User, value: unknown) {
    const provider = this.provider(value);
    await this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${this.lockKey(user, provider)}, 0))`.execute(
        trx,
      );
      await trx
        .deleteFrom('integrationPreviewConnections')
        .where('workspaceId', '=', user.workspaceId)
        .where('userId', '=', user.id)
        .where('provider', '=', provider)
        .execute();
    });
    this.clearUserCache(user);
    return { disconnected: true };
  }

  async resolve(
    user: User,
    pageId: string,
    value: unknown,
  ): Promise<IntegrationPreviewResult> {
    const target = parseIntegrationPreviewUrl(value);
    if (!target) throw new BadRequestException('Unsupported integration URL');
    await this.assertPage(user, pageId);
    const basic = {
      url: target.url,
      provider: target.provider,
      kind: target.kind,
    };
    const settings = await this.settings(user.workspaceId);
    if (
      !settings.enabled ||
      !settings.availableProviders.includes(target.provider)
    )
      return { ...basic, status: 'disabled' };
    const connection = await this.connection(user, target.provider);
    if (!connection && target.provider !== 'github')
      return { ...basic, status: 'connectionRequired' };
    const key = `${user.workspaceId}:${user.id}:${connection?.id ?? 'public'}:${connection?.revision ?? 0}:${target.url}`;
    const cached = this.cache.get(key);
    const validCache =
      cached && cached.expiresAt > Date.now() ? cached : undefined;
    let result: IntegrationPreviewResult;
    try {
      let token: string | null = null;
      if (connection) {
        if (!isEncryptedProtectedValue(connection.credential))
          throw new Error('Unprotected integration credential');
        token = decryptProtectedValue(
          connection.credential,
          this.credentialKey(user, connection.id),
        );
      }
      // Private metadata always revalidates provider authorization, even with an ETag.
      if (validCache && !connection) result = validCache.result;
      else {
        const response = await this.readBounded(
          user,
          target,
          token,
          validCache?.etag ?? undefined,
        );
        if (response.status === 304 && validCache) result = validCache.result;
        else if (response.status === 429)
          result = { ...basic, status: 'rateLimited' };
        else if (response.status !== 200 || !response.data)
          result = { ...basic, status: 'unavailable' };
        else {
          const data =
            target.provider === 'figma' ? response.data.file : response.data;
          const title =
            target.kind === 'repository'
              ? (data?.full_name ?? data?.name_with_namespace)
              : target.kind === 'commit'
                ? (data?.commit?.message?.split('\n')[0] ?? data?.title)
                : (data?.title ?? data?.name);
          const states = ['open', 'opened', 'closed', 'merged'];
          const state =
            data?.archived === true
              ? 'archived'
              : data?.merged_at
                ? 'merged'
                : states.includes(data?.state)
                  ? data.state === 'opened'
                    ? 'open'
                    : data.state
                  : undefined;
          result = {
            ...basic,
            status: 'ready',
            title: safeText(title, 250),
            description: safeText(
              target.kind === 'repository' ? data?.description : '',
              1200,
            ),
            ...(state ? { state } : {}),
          };
          if (!result.title) result = { ...basic, status: 'unavailable' };
        }
        if (result.status === 'ready') {
          if (this.cache.size >= 256)
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, {
            result,
            etag: response.etag ?? validCache?.etag ?? null,
            expiresAt: Date.now() + 60_000,
          });
        } else this.cache.delete(key);
      }
    } catch {
      this.cache.delete(key);
      result = { ...basic, status: 'unavailable' };
    }
    await this.assertPage(user, pageId);
    const current = await this.connection(user, target.provider);
    if (
      (current?.id ?? null) !== (connection?.id ?? null) ||
      current?.revision !== connection?.revision ||
      !(await this.settings(user.workspaceId)).enabled
    )
      return { ...basic, status: 'unavailable' };
    if (connection && result.status === 'ready')
      await this.db
        .updateTable('integrationPreviewConnections')
        .set({ lastUsedAt: new Date() })
        .where('id', '=', connection.id)
        .where('revision', '=', connection.revision)
        .execute();
    return result;
  }

  private connection(user: User, provider: IntegrationPreviewProvider) {
    return this.db
      .selectFrom('integrationPreviewConnections')
      .selectAll()
      .where('workspaceId', '=', user.workspaceId)
      .where('userId', '=', user.id)
      .where('provider', '=', provider)
      .executeTakeFirst();
  }
  private async readBounded(
    user: User,
    target: Parameters<IntegrationPreviewHttpService['read']>[0],
    token: string | null,
    etag?: string,
  ) {
    const key = `${user.workspaceId}:${user.id}`;
    const active = this.activeByUser.get(key) ?? 0;
    if (active >= 8 || this.activeTotal >= 32)
      return { status: 429, data: null, etag: null };
    this.activeByUser.set(key, active + 1);
    this.activeTotal++;
    try {
      return await this.http.read(target, token, etag);
    } finally {
      const remaining = (this.activeByUser.get(key) ?? 1) - 1;
      if (remaining) this.activeByUser.set(key, remaining);
      else this.activeByUser.delete(key);
      this.activeTotal--;
    }
  }
  private provider(value: unknown): IntegrationPreviewProvider {
    if (
      !INTEGRATION_PREVIEW_PROVIDERS.includes(
        value as IntegrationPreviewProvider,
      )
    )
      throw new BadRequestException('Unsupported integration provider');
    return value as IntegrationPreviewProvider;
  }
  private lockKey(user: User, provider: IntegrationPreviewProvider) {
    return `integration-preview:${user.workspaceId}:${user.id}:${provider}`;
  }
  private credentialKey(user: User, id: string) {
    return createHmac('sha256', this.environment.getAppSecret())
      .update(`integration-preview:v1:${user.workspaceId}:${user.id}:${id}`)
      .digest('hex');
  }
  private clearUserCache(user: User) {
    for (const key of this.cache.keys())
      if (key.startsWith(`${user.workspaceId}:${user.id}:`))
        this.cache.delete(key);
  }
  private async assertPage(user: User, pageId: string) {
    const page = await this.pages.findById(pageId);
    if (!page || page.deletedAt || page.workspaceId !== user.workspaceId)
      throw new NotFoundException('Page not found');
    await this.access.assertCanReadPage(page, user);
  }
}
