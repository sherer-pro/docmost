import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { AiErrorCode } from '@docmost/api-contract';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { AiMcpUrlPolicyService } from '../services/ai-mcp-url-policy.service';
import { AiOperationalMetricsService } from '../services/ai-operational-metrics.service';
import { decryptAiMcpHeaders } from './ai-mcp-headers.util';
import {
  AiMcpPinnedFetch,
  AiMcpTransportError,
  createAiMcpPinnedFetch,
} from './ai-mcp-pinned-fetch';
import {
  AiMcpDiscoveredRemoteTool,
  AiMcpLease,
  AiMcpPolicyError,
  AiMcpProbeResult,
} from './ai-mcp.types';
import {
  AI_MCP_ABSOLUTE_TTL_MS,
  AI_MCP_CONNECT_TIMEOUT_MS,
  AI_MCP_IDLE_TIMEOUT_MS,
  AI_MCP_IDLE_TTL_MS,
  AI_MCP_MAX_CACHED_CLIENTS,
  AI_MCP_MAX_DISCOVERED_TOOLS,
  AI_MCP_MAX_DISCOVERY_PAGES,
  AI_MCP_PROBE_TOTAL_TIMEOUT_MS,
  AI_MCP_REDIS_INVALIDATION_CHANNEL,
  AI_MCP_TOTAL_TIMEOUT_MS,
} from './ai-mcp.constants';

const CLIENT_INFO = { name: 'docmost', version: '1.0.0' };

type Connection = {
  client: Client;
  transport: StreamableHTTPClientTransport;
  guard: AiMcpPinnedFetch;
  protocolVersion: string | null;
  serverName: string | null;
  serverVersion: string | null;
};

type CacheEntry = Connection & {
  key: string;
  serverId: string;
  namespace: string;
  idleDeadline: number;
  absoluteDeadline: number;
  refCount: number;
  retiring: boolean;
  closed: boolean;
};

export type AiMcpAcquireParams = {
  serverId: string;
  workspaceId: string;
  /** Version the caller resolved its capability list from. */
  expectedConfigVersion: number;
  expectedPolicyVersion: number;
};

export type AiMcpProbeParams = {
  workspaceId: string;
  url: string;
  headers: Record<string, string>;
  /** Discovery walks tools/list pagination; a test only initializes. */
  mode: 'test' | 'discover';
};

@Injectable()
export class AiMcpClientPoolService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiMcpClientPoolService.name);
  /**
   * Holds the build promise, not the entry. Concurrent acquisitions of a cold
   * key await one build instead of each creating a transport and leaking the
   * losers.
   */
  private readonly cache = new Map<string, Promise<CacheEntry>>();
  /**
   * Settled entries only.
   *
   * Eviction, sweeping, and shutdown read this map instead of awaiting the
   * promises in `cache`. Awaiting a build from inside another build deadlocks:
   * a build awaiting its own promise never settles, and two concurrent builds
   * can wait on each other.
   */
  private readonly entries = new Map<string, CacheEntry>();
  private readonly buildControllers = new Map<string, AbortController>();
  private readonly serverInvalidationEpoch = new Map<string, number>();
  private subscriber: Redis | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
    private readonly urlPolicy: AiMcpUrlPolicyService,
    private readonly redisService: RedisService,
    private readonly metrics: AiOperationalMetricsService,
  ) {}

  onModuleInit(): void {
    this.sweepTimer = setInterval(() => {
      void this.sweepExpired();
    }, 60_000);
    this.sweepTimer.unref?.();

    try {
      const subscriber = this.redisService.getOrThrow().duplicate();
      this.subscriber = subscriber;
      void subscriber
        .subscribe(AI_MCP_REDIS_INVALIDATION_CHANNEL)
        .catch((error: unknown) => {
          this.logger.warn(
            `External MCP invalidation subscribe failed: ${this.safeReason(error)}`,
          );
        });
      subscriber.on('message', (_channel: string, payload: string) => {
        try {
          const parsed = JSON.parse(payload) as { serverId?: string };
          if (parsed.serverId) {
            void this.invalidateServer(parsed.serverId, 'remote');
          }
        } catch {
          // A malformed notification is ignored: version re-verification on the
          // next acquire is what actually guarantees freshness.
        }
      });
    } catch (error) {
      this.logger.warn(
        `External MCP invalidation channel unavailable: ${this.safeReason(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    for (const controller of this.buildControllers.values()) {
      controller.abort();
    }
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.subscriber) {
      this.subscriber.removeAllListeners('message');
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }

    const pending = [...this.cache.values()];
    this.cache.clear();
    // Await the in-flight builds too, so a connection that finishes opening
    // during shutdown is still closed instead of leaking.
    const settled = await Promise.all(
      pending.map((build) => build.catch(() => null)),
    );
    await Promise.all(
      [...new Set([...this.entries.values(), ...settled])]
        .filter((entry): entry is CacheEntry => entry !== null)
        .map((entry) => this.closeEntry(entry)),
    );
  }

  /**
   * Leases a connected client for one tool call.
   *
   * Freshness is guaranteed by re-reading the server and workspace versions
   * here, not by Redis. A missed invalidation costs one query; it can never
   * hand back a client built from superseded configuration.
   */
  async acquire(params: AiMcpAcquireParams): Promise<AiMcpLease> {
    this.assertRunning();
    if (!this.environmentService.isAiExternalMcpEnabled()) {
      throw new AiMcpPolicyError(
        'external_mcp_disabled',
        'External MCP is disabled for this deployment',
      );
    }

    const state = await this.loadServerState(params.serverId, params.workspaceId);
    this.assertRunning();
    if (
      state.configVersion !== params.expectedConfigVersion ||
      state.policyVersion !== params.expectedPolicyVersion
    ) {
      throw new AiMcpPolicyError(
        'agent_mcp_config_changed',
        'External MCP configuration changed',
      );
    }

    const key = `${params.serverId}:${state.configVersion}:${state.policyVersion}`;
    const entry = await this.getOrBuild(key, state);
    this.assertRunning();
    if (entry.retiring || entry.closed) {
      throw new AiMcpPolicyError(
        'agent_mcp_config_changed',
        'External MCP client was invalidated while opening',
      );
    }
    entry.refCount += 1;
    entry.idleDeadline = Date.now() + AI_MCP_IDLE_TTL_MS;
    this.observeLeases();
    return this.createLease(entry);
  }

  /**
   * Opens a throwaway connection for an administrator action.
   *
   * Never cached and always closed, so a failing candidate server cannot affect
   * agent runs or occupy a cache slot.
   */
  async probe(params: AiMcpProbeParams): Promise<AiMcpProbeResult> {
    this.assertRunning();
    if (!this.environmentService.isAiExternalMcpEnabled()) {
      throw new AiMcpPolicyError(
        'external_mcp_disabled',
        'External MCP is disabled for this deployment',
      );
    }

    const startedAt = Date.now();
    const deadline = startedAt + AI_MCP_PROBE_TOTAL_TIMEOUT_MS;
    const settings = await this.loadWorkspaceSettings(params.workspaceId);
    const connection = await this.connect({
      url: params.url,
      workspaceAllowedOrigins: settings.allowedOrigins,
      headers: params.headers,
      deadline,
    });

    try {
      const tools =
        params.mode === 'discover'
          ? await this.listAllTools(connection.client, deadline)
          : [];
      return {
        latencyMs: Date.now() - startedAt,
        protocolVersion: connection.protocolVersion,
        serverName: connection.serverName,
        serverVersion: connection.serverVersion,
        tools,
      };
    } finally {
      await this.closeConnection(connection);
    }
  }

  /** Drops every cached client for a server and publishes the change. */
  async invalidateServer(serverId: string, reason: string): Promise<void> {
    this.serverInvalidationEpoch.set(
      serverId,
      (this.serverInvalidationEpoch.get(serverId) ?? 0) + 1,
    );
    const prefix = `${serverId}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(prefix)) {
        this.buildControllers.get(key)?.abort();
        this.cache.delete(key);
      }
    }
    for (const entry of [...this.entries.values()]) {
      if (entry.serverId === serverId) {
        await this.retire(entry, reason);
      }
    }
  }

  async publishInvalidation(serverId: string, reason: string): Promise<void> {
    await this.invalidateServer(serverId, reason);
    try {
      // The payload carries no URL, headers, or workspace identifier.
      await this.redisService
        .getOrThrow()
        .publish(
          AI_MCP_REDIS_INVALIDATION_CHANNEL,
          JSON.stringify({ serverId, reason }),
        );
    } catch (error) {
      this.logger.warn(
        `External MCP invalidation publish failed: ${this.safeReason(error)}`,
      );
    }
  }

  private async getOrBuild(
    key: string,
    state: ServerState,
  ): Promise<CacheEntry> {
    const pending = this.cache.get(key);
    if (pending) {
      const entry = await pending;
      const now = Date.now();
      if (
        !entry.retiring &&
        !entry.closed &&
        entry.absoluteDeadline > now &&
        entry.idleDeadline > now
      ) {
        this.metrics.observeMcpCache('hit');
        return entry;
      }
      // Only evict the entry this caller observed; a concurrent rebuild may
      // already have installed a fresh one under the same key.
      if (this.cache.get(key) === pending) {
        this.cache.delete(key);
        await this.retire(entry, 'expired');
      }
    }

    return this.startBuild(key, state);
  }

  /**
   * Installs the build promise before yielding.
   *
   * Nothing may be awaited between the cache miss and `cache.set`, or concurrent
   * callers all observe an empty slot and each opens its own transport, leaking
   * every connection but the last.
   */
  private startBuild(key: string, state: ServerState): Promise<CacheEntry> {
    this.assertRunning();
    this.metrics.observeMcpCache('miss');
    const controller = new AbortController();
    const epoch = this.serverInvalidationEpoch.get(state.serverId) ?? 0;
    this.buildControllers.set(key, controller);
    const build = (async () => {
      await this.enforceCapacity(key);
      this.assertRunning();
      const entry = await this.buildEntry(key, state, controller.signal);
      if (
        controller.signal.aborted ||
        this.destroyed ||
        (this.serverInvalidationEpoch.get(state.serverId) ?? 0) !== epoch
      ) {
        await this.closeConnection(entry);
        throw new AiMcpPolicyError(
          'agent_mcp_config_changed',
          'External MCP client was invalidated while opening',
        );
      }
      this.entries.set(key, entry);
      return entry;
    })().catch((error: unknown) => {
      if (this.cache.get(key) === build) {
        this.cache.delete(key);
      }
      throw error;
    }).finally(() => {
      if (this.buildControllers.get(key) === controller) {
        this.buildControllers.delete(key);
      }
    });
    this.cache.set(key, build);
    return build;
  }

  private async buildEntry(
    key: string,
    state: ServerState,
    signal: AbortSignal,
  ): Promise<CacheEntry> {
    const connection = await this.connect({
      url: state.url,
      workspaceAllowedOrigins: state.allowedOrigins,
      headers: decryptAiMcpHeaders(
        state.headersEncrypted,
        this.environmentService.getAppSecret(),
      ),
      signal,
    });
    const now = Date.now();
    return {
      ...connection,
      key,
      serverId: state.serverId,
      namespace: state.namespace,
      idleDeadline: now + AI_MCP_IDLE_TTL_MS,
      absoluteDeadline: now + AI_MCP_ABSOLUTE_TTL_MS,
      refCount: 0,
      retiring: false,
      closed: false,
    };
  }

  private async connect(params: {
    url: string;
    workspaceAllowedOrigins: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
    deadline?: number;
  }): Promise<Connection> {
    const resolvedPromise = this.urlPolicy.resolveAllowedForWorkspace(
      params.url,
      params.workspaceAllowedOrigins,
    );
    const resolved = params.deadline
      ? await this.withTimeout(
          resolvedPromise,
          this.remainingTimeout(params.deadline),
          'external_mcp_timeout',
          'External MCP probe timed out',
        )
      : await resolvedPromise;
    if (params.signal?.aborted) {
      throw new AiMcpPolicyError(
        'agent_mcp_config_changed',
        'External MCP client build was invalidated',
      );
    }
    const guard = createAiMcpPinnedFetch({
      approvedHref: resolved.url.href,
      addresses: resolved.addresses,
    });
    params.signal?.addEventListener('abort', () => guard.abort(), { once: true });

    const transport = new StreamableHTTPClientTransport(resolved.url, {
      // Only administrator headers. Every other policy lives in the fetch
      // override, because the transport clobbers `signal` and skips
      // `requestInit` entirely on the GET SSE stream.
      requestInit: { headers: params.headers },
      fetch: guard.fetch as never,
      // The default is two retries, which would reopen the SSE stream after a
      // lease was discarded.
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1_000,
        maxReconnectionDelay: 1_000,
        reconnectionDelayGrowFactor: 1,
      },
      // authProvider is intentionally omitted: no OAuth browser flow.
    });

    const client = new Client(CLIENT_INFO, {
      capabilities: {},
      // Declaring no capabilities and enforcing them makes sampling,
      // elicitation, and roots structurally unavailable to a remote server.
      enforceStrictCapabilities: true,
    });

    try {
      await this.withTimeout(
        client.connect(transport),
        params.deadline
          ? Math.min(
              AI_MCP_CONNECT_TIMEOUT_MS,
              this.remainingTimeout(params.deadline),
            )
          : AI_MCP_CONNECT_TIMEOUT_MS,
        'external_mcp_timeout',
        'External MCP connection timed out',
      );
      if (params.signal?.aborted) {
        throw new AiMcpPolicyError(
          'agent_mcp_config_changed',
          'External MCP client build was invalidated',
        );
      }
      if (params.deadline) {
        this.remainingTimeout(params.deadline);
      }
    } catch (error) {
      guard.abort();
      await transport.close().catch(() => undefined);
      await guard.close().catch(() => undefined);
      throw this.toTransportError(error);
    }

    const version = client.getServerVersion();
    return {
      client,
      transport,
      guard,
      protocolVersion: this.readProtocolVersion(transport),
      serverName: typeof version?.name === 'string' ? version.name : null,
      serverVersion:
        typeof version?.version === 'string' ? version.version : null,
    };
  }

  private async listAllTools(
    client: Client,
    deadline: number,
  ): Promise<AiMcpDiscoveredRemoteTool[]> {
    const tools: AiMcpDiscoveredRemoteTool[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < AI_MCP_MAX_DISCOVERY_PAGES; page += 1) {
      const remaining = this.remainingTimeout(deadline);
      const result = await this.withTimeout(
        client.listTools(cursor ? { cursor } : undefined, {
          timeout: Math.min(AI_MCP_IDLE_TIMEOUT_MS, remaining),
          maxTotalTimeout: remaining,
        }),
        remaining,
        'external_mcp_timeout',
        'External MCP tool listing timed out',
      );

      for (const tool of result.tools ?? []) {
        tools.push({
          remoteName: String(tool.name),
          title: typeof tool.title === 'string' ? tool.title : null,
          description:
            typeof tool.description === 'string' ? tool.description : null,
          inputSchema: tool.inputSchema,
          annotations:
            tool.annotations && typeof tool.annotations === 'object'
              ? (tool.annotations as Record<string, unknown>)
              : null,
        });
      }

      // Rejecting rather than truncating: a truncated catalog would make
      // "the administrator approved everything they saw" false.
      if (tools.length > AI_MCP_MAX_DISCOVERED_TOOLS) {
        throw new AiMcpTransportError(
          'external_mcp_invalid_response',
          `External MCP server advertises more than ${AI_MCP_MAX_DISCOVERED_TOOLS} tools`,
        );
      }

      cursor = result.nextCursor ? String(result.nextCursor) : undefined;
      if (!cursor) {
        return tools;
      }
    }

    throw new AiMcpTransportError(
      'external_mcp_invalid_response',
      'External MCP tool listing exceeded the page limit',
    );
  }

  private createLease(entry: CacheEntry): AiMcpLease {
    let settled = false;
    const startBytes = entry.guard.wireBytes();

    const finish = (): void => {
      settled = true;
      entry.refCount -= 1;
      this.observeLeases();
      if (entry.refCount <= 0 && (entry.retiring || this.destroyed)) {
        void this.closeEntry(entry);
      }
    };

    return {
      serverId: entry.serverId,
      namespace: entry.namespace,
      wireBytes: () => entry.guard.wireBytes() - startBytes,
      callTool: async (remoteName, args, options) => {
        const signals: AbortSignal[] = [];
        if (options?.signal) {
          signals.push(options.signal);
        }
        return this.callTool(entry, remoteName, args, options, signals);
      },
      release: () => {
        if (!settled) {
          finish();
        }
      },
      discard: (reason: string) => {
        if (settled) {
          return;
        }
        finish();
        void this.retire(entry, reason);
      },
    };
  }

  private async callTool(
    entry: CacheEntry,
    remoteName: string,
    args: Record<string, unknown>,
    options: { idleTimeoutMs?: number; totalTimeoutMs?: number } | undefined,
    signals: AbortSignal[],
  ): Promise<unknown> {
    const signal =
      signals.length > 0 ? AbortSignal.any(signals) : undefined;

    return entry.client.callTool(
      { name: remoteName, arguments: args },
      CallToolResultSchema,
      {
        ...(signal ? { signal } : {}),
        timeout: options?.idleTimeoutMs ?? AI_MCP_IDLE_TIMEOUT_MS,
        resetTimeoutOnProgress: true,
        maxTotalTimeout: options?.totalTimeoutMs ?? AI_MCP_TOTAL_TIMEOUT_MS,
      },
    );
  }

  private async enforceCapacity(excludeKey: string): Promise<void> {
    const occupied = [...this.cache.keys()].filter(
      (key) => key !== excludeKey,
    ).length;
    if (occupied < AI_MCP_MAX_CACHED_CLIENTS) {
      return;
    }

    let victim: CacheEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.key === excludeKey || entry.refCount > 0 || entry.retiring) {
        continue;
      }
      if (!victim || entry.idleDeadline < victim.idleDeadline) {
        victim = entry;
      }
    }

    if (!victim) {
      // Closing a leased client would break a run in flight, so refuse instead.
      throw new AiMcpPolicyError(
        'agent_mcp_capacity',
        'No external MCP connection slot is available',
      );
    }

    this.cache.delete(victim.key);
    this.metrics.observeMcpCache('evict');
    await this.retire(victim, 'capacity');
  }

  private async sweepExpired(): Promise<void> {
    const now = Date.now();
    for (const entry of [...this.entries.values()]) {
      if (entry.idleDeadline <= now || entry.absoluteDeadline <= now) {
        this.cache.delete(entry.key);
        await this.retire(entry, 'expired');
      }
    }
  }

  /**
   * Removes an entry from service.
   *
   * A leased entry is aborted immediately so its holder fails fast rather than
   * blocking the close for a full timeout, then closed once the lease returns.
   */
  private async retire(entry: CacheEntry, reason: string): Promise<void> {
    if (entry.closed) {
      return;
    }
    entry.retiring = true;
    this.metrics.observeMcpCache('retire');
    this.observeLeases();
    if (entry.refCount > 0) {
      entry.guard.abort();
      this.logger.debug(`External MCP client retiring (${reason})`);
      return;
    }
    await this.closeEntry(entry);
  }

  private async closeEntry(entry: CacheEntry): Promise<void> {
    if (entry.closed) {
      return;
    }
    entry.closed = true;
    this.cache.delete(entry.key);
    this.entries.delete(entry.key);
    this.metrics.observeMcpCache('close');
    this.observeLeases();
    await this.closeConnection(entry);
  }

  private async closeConnection(connection: Connection): Promise<void> {
    // transport.close() aborts the SDK's controller, which is the only thing
    // that tears down an in-flight request and the SSE stream.
    await connection.transport.close().catch(() => undefined);
    await connection.client.close().catch(() => undefined);
    await connection.guard.close().catch(() => undefined);
  }

  private async loadServerState(
    serverId: string,
    workspaceId: string,
  ): Promise<ServerState> {
    const settings = await this.loadWorkspaceSettings(workspaceId);
    if (!settings.enabled) {
      throw new AiMcpPolicyError(
        'external_mcp_disabled',
        'External MCP is disabled for this workspace',
      );
    }

    const server = await this.db
      .selectFrom('aiMcpServers')
      .select([
        'id',
        'namespace',
        'url',
        'headersEncrypted',
        'enabled',
        'configVersion',
      ])
      .where('id', '=', serverId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!server) {
      throw new AiMcpPolicyError(
        'agent_mcp_access_revoked',
        'External MCP server is no longer available',
      );
    }
    if (!server.enabled) {
      throw new AiMcpPolicyError(
        'agent_mcp_access_revoked',
        'External MCP server is disabled',
      );
    }

    return {
      serverId: server.id,
      namespace: server.namespace,
      url: server.url,
      headersEncrypted: server.headersEncrypted,
      configVersion: Number(server.configVersion),
      policyVersion: settings.policyVersion,
      allowedOrigins: settings.allowedOrigins,
    };
  }

  private async loadWorkspaceSettings(workspaceId: string): Promise<{
    enabled: boolean;
    allowedOrigins: string;
    policyVersion: number;
  }> {
    const row = await this.db
      .selectFrom('aiMcpWorkspaceSettings')
      .select(['enabled', 'allowedOrigins', 'policyVersion'])
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    // A missing row means disabled. It is never created lazily, so a read can
    // not turn the feature on.
    return {
      enabled: row?.enabled ?? false,
      allowedOrigins: row?.allowedOrigins ?? '',
      policyVersion: row ? Number(row.policyVersion) : 0,
    };
  }

  private readProtocolVersion(
    transport: StreamableHTTPClientTransport,
  ): string | null {
    const value = (transport as { protocolVersion?: unknown }).protocolVersion;
    return typeof value === 'string' ? value : null;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    code: AiErrorCode,
    message: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new AiMcpTransportError(code, message)),
            timeoutMs,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private remainingTimeout(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new AiMcpTransportError(
        'external_mcp_timeout',
        'External MCP probe timed out',
      );
    }
    return remaining;
  }

  private assertRunning(): void {
    if (this.destroyed) {
      throw new AiMcpPolicyError(
        'external_mcp_unavailable',
        'External MCP client pool is shutting down',
      );
    }
  }

  private observeLeases(): void {
    let active = 0;
    let retiring = 0;
    for (const entry of this.entries.values()) {
      active += Math.max(0, entry.refCount);
      if (entry.retiring) {
        retiring += Math.max(0, entry.refCount);
      }
    }
    this.metrics.observeMcpLeases(active, retiring);
  }

  private toTransportError(error: unknown): Error {
    if (
      error instanceof AiMcpTransportError ||
      error instanceof AiMcpPolicyError
    ) {
      return error;
    }
    return new AiMcpTransportError(
      'external_mcp_unavailable',
      'External MCP server could not be reached',
    );
  }

  /** First line only, capped, so no upstream body or URL reaches a log. */
  private safeReason(error: unknown): string {
    const message =
      error instanceof Error ? error.message : String(error ?? 'unknown');
    return message.split('\n')[0].slice(0, 200);
  }
}

type ServerState = {
  serverId: string;
  namespace: string;
  url: string;
  headersEncrypted: string | null;
  configVersion: number;
  policyVersion: number;
  allowedOrigins: string;
};
