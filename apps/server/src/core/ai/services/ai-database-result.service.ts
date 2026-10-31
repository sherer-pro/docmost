import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { validate as isUuid } from 'uuid';
import {
  AiDatabaseResultCard,
  AiDatabaseResultRows,
  AiDatabaseReadReceipt,
  DatabaseSummary,
  DatabaseViewState,
  normalizeDatabaseViewState,
} from '@docmost/api-contract';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AiRunService } from './ai-run.service';
import {
  AiDatabaseService,
  normalizeAiDatabaseContext,
} from './ai-database.service';
import { AiConfigService } from './ai-config.service';
import { AiAssistantProfileService } from './ai-assistant-profile.service';
import { AiBuiltinToolPolicyService } from '../tools/ai-builtin-tool-policy.service';
import {
  AiSourceAccessChangedError,
  AiSourceAccessService,
} from './ai-source-access.service';

const READ_TOOLS = ['queryDatabaseView', 'summarizeDatabaseView'];
const object = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

type StoredDatabaseResult = Partial<DatabaseSummary> & {
  databaseId: string;
  receipt: AiDatabaseReadReceipt;
  viewState: DatabaseViewState;
  groupKey?: string;
  items?: unknown[];
  complete?: boolean;
  hasMore?: boolean;
  truncated?: boolean;
};

@Injectable()
export class AiDatabaseResultService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly runs: AiRunService,
    private readonly databases: AiDatabaseService,
    private readonly configs: AiConfigService,
    private readonly profiles: AiAssistantProfileService,
    private readonly tools: AiBuiltinToolPolicyService,
    private readonly sources: AiSourceAccessService,
  ) {}

  private async owned(runId: string, user: User, workspace: Workspace) {
    const run = await this.runs.getOwnedRun(runId, user, workspace);
    await this.runs.assertRunSourcesAccessible(run, user);
    const config = await this.configs.getRawConfig(run.spaceId, workspace.id);
    if (!config?.enabled || run.executionMode !== 'agent') {
      throw new ForbiddenException('AI database results are unavailable');
    }
    await this.profiles.assertRunProfileCurrent(run);
    const definitions = await this.tools.assertRunPolicyCurrent(run);
    return { run, allowed: new Set(definitions.map((tool) => tool.name)) };
  }

  private storedResult(step: any): StoredDatabaseResult | null {
    const value = step.result;
    const receipt = object(value) && value.receipt;
    if (
      !READ_TOOLS.includes(step.toolName) ||
      (step.toolSource ?? 'builtin') !== 'builtin' ||
      step.writeClass !== 'read_only' ||
      step.status !== 'completed' ||
      !object(value) ||
      value.scope !== 'accessible_ai_allowed_rows' ||
      !isUuid(value.databaseId ?? '') ||
      !object(receipt) ||
      receipt.version !== 1 ||
      receipt.mode !==
        (step.toolName === 'summarizeDatabaseView' ? 'summary' : 'query') ||
      !isUuid(receipt.databasePageId ?? '') ||
      typeof receipt.databaseTitle !== 'string' ||
      typeof receipt.asOf !== 'string' ||
      !Number.isFinite(Date.parse(receipt.asOf)) ||
      !/^[a-f0-9]{64}$/.test(receipt.schemaFingerprint ?? '') ||
      !Number.isInteger(receipt.selectedRowCount) ||
      receipt.selectedRowCount < 0 ||
      receipt.selectedRowCount > 200 ||
      !object(receipt.propertyLabels) ||
      Object.values(receipt.propertyLabels).some(
        (label) => typeof label !== 'string',
      )
    ) {
      return null;
    }
    try {
      return {
        ...value,
        receipt: receipt as AiDatabaseReadReceipt,
        viewState: normalizeDatabaseViewState(value.viewState),
      } as StoredDatabaseResult;
    } catch {
      return null;
    }
  }

  private context(
    owned: Awaited<ReturnType<AiDatabaseResultService['owned']>>,
    value: NonNullable<ReturnType<AiDatabaseResultService['storedResult']>>,
    user: User,
  ) {
    const frozen = owned.run.databaseContext
      ? normalizeAiDatabaseContext(owned.run.databaseContext)
      : undefined;
    return {
      user,
      workspaceId: owned.run.workspaceId,
      spaceId: owned.run.spaceId,
      currentPageId: owned.run.pageId,
      databaseContext: normalizeAiDatabaseContext({
        databaseId: value.databaseId,
        viewId:
          frozen?.databaseId === value.databaseId ? frozen.viewId : undefined,
        viewState: value.viewState,
        groupKey: value.groupKey,
        selectedPageIds:
          frozen?.databaseId === value.databaseId ? frozen.selectedPageIds : [],
      }),
    };
  }

  private async card(
    owned: Awaited<ReturnType<AiDatabaseResultService['owned']>>,
    step: any,
    user: User,
  ): Promise<AiDatabaseResultCard | null> {
    const value = this.storedResult(step);
    // Legacy steps have no server receipt and cannot be reconstructed from prose.
    if (!value) return null;
    if (!owned.allowed.has(step.toolName)) {
      throw new ForbiddenException('The database tool is no longer allowed');
    }
    const scoped = await this.databases.scope(
      value.databaseId,
      this.context(owned, value, user),
      {},
    );
    if (scoped.database.pageId !== value.receipt.databasePageId) {
      throw new NotFoundException('Database result source changed');
    }
    const source = await this.db
      .selectFrom('pages')
      .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select(['pages.slugId', 'spaces.slug'])
      .where('pages.id', '=', scoped.database.pageId)
      .where('pages.workspaceId', '=', owned.run.workspaceId)
      .where('pages.spaceId', '=', owned.run.spaceId)
      .where('pages.deletedAt', 'is', null)
      .executeTakeFirst();
    if (!source)
      throw new NotFoundException('Database result source not found');
    const summary =
      value.receipt.mode === 'summary' &&
      Number.isSafeInteger(value.count) &&
      value.count >= 0 &&
      object(value.values) &&
      Array.isArray(value.groups)
        ? ({
            count: value.count,
            values: value.values,
            groups: value.groups,
            ...(object(value.errors) ? { errors: value.errors } : {}),
          } as DatabaseSummary)
        : null;
    if (value.receipt.mode === 'summary' && !summary) return null;
    if (value.receipt.mode === 'query' && !Array.isArray(value.items))
      return null;
    return {
      runId: owned.run.id,
      stepId: step.id,
      databaseId: value.databaseId,
      receipt: value.receipt,
      viewState: value.viewState,
      groupKey: value.groupKey,
      scope: 'accessible_ai_allowed_rows',
      summary,
      returnedRows: Array.isArray(value.items) ? value.items.length : 0,
      incomplete: summary
        ? value.complete !== true || Object.keys(value.errors ?? {}).length > 0
        : value.hasMore === true || value.truncated === true,
      canOpenRows: owned.allowed.has('queryDatabaseView'),
      sourceUrl: `/s/${encodeURIComponent(source.slug)}/db/${encodeURIComponent(source.slugId)}`,
      resultUrl: `/s/${encodeURIComponent(source.slug)}/ai/database-results/${owned.run.id}/${step.id}`,
    };
  }

  async list(runId: string, user: User, workspace: Workspace) {
    const owned = await this.owned(runId, user, workspace);
    const steps = await this.db
      .selectFrom('aiRunSteps')
      .selectAll()
      .where('runId', '=', owned.run.id)
      .where('toolName', 'in', READ_TOOLS)
      .where('writeClass', '=', 'read_only')
      .where('status', '=', 'completed')
      .orderBy('sequence')
      .execute();
    const cards: AiDatabaseResultCard[] = [];
    for (const step of steps) {
      const card = await this.card(owned, step, user);
      if (card) cards.push(card);
    }
    await this.owned(runId, user, workspace);
    return cards;
  }

  async rows(
    runId: string,
    stepId: string,
    cursor: string | undefined,
    user: User,
    workspace: Workspace,
  ): Promise<AiDatabaseResultRows> {
    const owned = await this.owned(runId, user, workspace);
    const step = await this.db
      .selectFrom('aiRunSteps')
      .selectAll()
      .where('id', '=', stepId)
      .where('runId', '=', owned.run.id)
      .executeTakeFirst();
    const value = step && this.storedResult(step);
    const card = step && (await this.card(owned, step, user));
    if (!value || !card)
      throw new NotFoundException('Database result not found');
    if (!card.canOpenRows) {
      throw new ForbiddenException('Querying database rows is not allowed');
    }
    // Reuse the frozen conditions, never caller-supplied filters or database IDs.
    const result = await this.databases.read(
      { databaseId: card.databaseId, limit: 25, cursor },
      this.context(owned, value, user),
      false,
      value.receipt.schemaFingerprint,
    );
    if (!('items' in result))
      throw new NotFoundException('Database result not found');
    const current = await this.owned(runId, user, workspace);
    if (!current.allowed.has('queryDatabaseView')) {
      throw new ForbiddenException(
        'Querying database rows is no longer allowed',
      );
    }
    try {
      await this.sources.assertAccessible(
        [
          ...new Set([
            card.receipt.databasePageId,
            ...result.dependencyPageIds,
          ]),
        ].map((pageId) => ({ sourceType: 'page', sourceId: pageId, pageId })),
        {
          user,
          workspaceId: owned.run.workspaceId,
          spaceId: owned.run.spaceId,
        },
      );
    } catch (error) {
      if (!(error instanceof AiSourceAccessChangedError)) throw error;
      throw new ForbiddenException({
        code: 'source_access_changed',
        message: 'AI database result sources are no longer accessible',
      });
    }
    return {
      card,
      asOf: result.receipt.asOf,
      properties: result.properties,
      items: result.items,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor ?? null,
    };
  }
}
