import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import path from 'node:path';
import { request } from '../../client/e2e/database/api-context.mjs';
import { evaluateDatabaseTrace } from '../../../scripts/ai-database-quality.mjs';
import {
  parseQualityQuestionIds,
  selectQualityQuestions,
} from './ai-quality-selection.mjs';
import {
  providerTextSegments,
  sourceWasTransmitted,
} from './ai-quality-transmission.mjs';

const option = (name, fallback) =>
  process.argv
    .find((arg) => arg.startsWith(`--quality-${name}=`))
    ?.slice(`--quality-${name}=`.length) ?? fallback;

export async function artifactHash(directory) {
  const digest = createHash('sha256');
  const visit = async (current, relative = '') => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const next = path.join(current, entry.name);
      const key = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(next, key);
      else if (entry.isFile()) digest.update(key).update(await readFile(next));
    }
  };
  await visit(directory);
  return digest.digest('hex');
}

export function databaseQualityConfiguration() {
  if (!process.argv.includes('--ai-quality')) return null;
  const url = new URL(option('provider', 'http://127.0.0.1:1234/v1'));
  assert(
    url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    'The isolated quality runner accepts an unauthenticated loopback provider only',
  );
  const split = option('split', 'tuning');
  assert(['tuning', 'holdout'].includes(split), 'Invalid quality split');
  const scope = option('scope', 'database');
  assert(['database', 'rag'].includes(scope), 'Invalid quality scope');
  const limit = Number(option('limit', '0'));
  assert(
    Number.isInteger(limit) && limit >= 0 && limit <= 120,
    'Invalid quality limit',
  );
  return {
    baseUrl: url.toString().replace(/\/$/, ''),
    origin: url.origin,
    model: option('model', 'google/gemma-4-12b-qat'),
    scope,
    split,
    limit,
    questionIds: parseQualityQuestionIds(option('ids', ''), split, limit),
    temperature: 0,
    maxOutputTokens: 4096,
    contextWindow: 65536,
    requestTimeoutMs: 600000,
  };
}

export async function runDatabaseQuality({
  baseURL,
  sql,
  output,
  exactSecrets,
  report,
  config,
  providerCapture,
}) {
  const corpusBytes = await readFile(
    new URL('../../../tests/rag-quality/corpus.json', import.meta.url),
  );
  const corpus = JSON.parse(corpusBytes);
  const questions = selectQualityQuestions(corpus.databaseQuestions, config);
  const databaseIds = new Set(
    questions.map((question) => question.databaseContext.databaseId),
  );
  const fixtures = corpus.databaseFixtures.filter((fixture) =>
    databaseIds.has(fixture.databaseId),
  );
  const contexts = [];
  const actor = async () => {
    const api = await request.newContext({
      baseURL,
      extraHTTPHeaders: { Origin: baseURL, Referer: `${baseURL}/` },
    });
    contexts.push(api);
    return { api };
  };
  const api = async (who, endpoint, method = 'GET', data) => {
    const csrf = (await who.api.storageState()).cookies.find(
      (cookie) => cookie.name === 'csrfToken',
    )?.value;
    const response = await who.api.fetch(`/api${endpoint}`, {
      method,
      ...(data === undefined ? {} : { data }),
      headers: csrf ? { 'x-csrf-token': csrf } : {},
      timeout: 200000,
    });
    if (!response.ok()) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `${method} ${endpoint.split('?')[0]} returned ${response.status()}: ${JSON.stringify(error.message ?? error.error ?? '').slice(0, 1000)}`,
      );
    }
    if (response.status() === 204) return null;
    const payload = await response.json();
    return payload.data ?? payload;
  };
  const password = () => {
    const value = `Aa1!${randomBytes(24).toString('base64url')}`;
    exactSecrets.add(value);
    return value;
  };
  try {
    const admin = await actor();
    await api(admin, '/auth/setup', 'POST', {
      name: 'Quality Administrator',
      email: 'quality-admin@example.test',
      password: password(),
      workspaceName: 'Isolated AI database quality',
      hostname: `quality${Date.now()}`,
    });
    const me = await api(admin, '/users/me');
    const workspaceId = me.workspace.id;
    admin.id = me.user.id;
    const email = 'quality-writer@example.test';
    await api(admin, '/workspace/invites/create', 'POST', {
      emails: [email],
      role: 'member',
      groupIds: [],
    });
    const invite = (
      await api(admin, '/workspace/invites?limit=100')
    ).items.find((item) => item.email === email);
    const linked = await api(admin, '/workspace/invites/link', 'POST', {
      invitationId: invite.id,
    });
    const token = new URL(
      typeof linked === 'string' ? linked : linked.inviteLink,
    ).searchParams.get('token');
    exactSecrets.add(token);
    const writer = await actor();
    await api(writer, '/workspace/invites/accept', 'POST', {
      invitationId: invite.id,
      token,
      name: 'Quality Writer',
      password: password(),
    });
    writer.id = (await api(writer, '/users/me')).user.id;
    const space = await api(admin, '/spaces', 'POST', {
      name: 'AI quality fixtures',
      slug: `quality${randomBytes(4).toString('hex')}`,
    });
    await api(admin, '/spaces/members/add', 'POST', {
      spaceId: space.id,
      userIds: [writer.id],
      groupIds: [],
      role: 'writer',
    });
    const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
    const exclusions = [];
    for (const fixture of fixtures) {
      const databaseId = fixture.databaseId;
      await sql`insert into pages(id,slug_id,title,position,creator_id,last_updated_by_id,space_id,workspace_id,content) values(${databaseId},${randomBytes(6).toString('base64url')},${fixture.name},${databaseId},${admin.id},${admin.id},${space.id},${workspaceId},${JSON.stringify(empty)}::text::jsonb)`;
      await sql`insert into databases(id,page_id,name,creator_id,last_updated_by_id,space_id,workspace_id) values(${databaseId},${databaseId},${fixture.name},${admin.id},${admin.id},${space.id},${workspaceId})`;
      const hidden = await api(admin, '/pages', 'POST', {
        spaceId: space.id,
        parentPageId: databaseId,
        title: 'Restricted records',
      });
      const excluded = await api(admin, '/pages', 'POST', {
        spaceId: space.id,
        parentPageId: databaseId,
        title: 'AI-excluded records',
      });
      const properties = [
        {
          id: fixture.properties.budgetId,
          name: 'Бюджет',
          type: 'number',
          settings: { format: 'number', precision: 2 },
        },
        {
          id: fixture.properties.statusId,
          name: 'Статус',
          type: 'select',
          settings: {
            options: [
              { value: 'open', label: 'open', color: 'blue' },
              { value: 'done', label: 'done', color: 'green' },
            ],
          },
        },
        {
          id: fixture.properties.dateId,
          name: 'Дата',
          type: 'date',
          settings: null,
        },
        {
          id: fixture.properties.notesId,
          name: 'Заметки',
          type: 'multiline_text',
          settings: null,
        },
      ];
      for (const [index, property] of properties.entries()) {
        await sql`insert into database_properties(id,database_id,workspace_id,name,type,position,creator_id,settings) values(${property.id},${databaseId},${workspaceId},${property.name},${property.type},${index},${admin.id},${JSON.stringify(property.settings)}::text::jsonb)`;
      }
      const pages = fixture.records.map((record, index) => ({
        id: record.pageId,
        slug_id: randomBytes(6).toString('base64url'),
        title: `Работа ${String(index + 1).padStart(4, '0')}`,
        position: String(index).padStart(5, '0'),
        parent_page_id: !record.readable
          ? hidden.id
          : !record.aiAllowed
            ? excluded.id
            : databaseId,
        creator_id: admin.id,
        last_updated_by_id: admin.id,
        space_id: space.id,
        workspace_id: workspaceId,
        content: empty,
      }));
      await sql`insert into pages(id,slug_id,title,position,parent_page_id,creator_id,last_updated_by_id,space_id,workspace_id,content) select id,slug_id,title,position,parent_page_id,creator_id,last_updated_by_id,space_id,workspace_id,content from jsonb_to_recordset(${JSON.stringify(pages)}::text::jsonb) x(id uuid,slug_id text,title text,position text,parent_page_id uuid,creator_id uuid,last_updated_by_id uuid,space_id uuid,workspace_id uuid,content jsonb)`;
      await sql`insert into database_rows(database_id,workspace_id,page_id,created_by_id,updated_by_id) select ${databaseId}::uuid,${workspaceId}::uuid,id,${admin.id}::uuid,${admin.id}::uuid from pages where id=any(${fixture.records.map((record) => record.pageId)}::uuid[])`;
      const cells = fixture.records.flatMap((record) => [
        {
          page_id: record.pageId,
          property_id: fixture.properties.budgetId,
          value: record.budget,
        },
        {
          page_id: record.pageId,
          property_id: fixture.properties.statusId,
          value: record.status,
        },
        {
          page_id: record.pageId,
          property_id: fixture.properties.dateId,
          value: record.date,
        },
        {
          page_id: record.pageId,
          property_id: fixture.properties.notesId,
          value: record.notes,
        },
      ]);
      await sql`insert into database_cells(database_id,workspace_id,page_id,property_id,value,created_by_id,updated_by_id) select ${databaseId}::uuid,${workspaceId}::uuid,page_id,property_id,value,${admin.id}::uuid,${admin.id}::uuid from jsonb_to_recordset(${JSON.stringify(cells)}::text::jsonb) x(page_id uuid,property_id uuid,value jsonb)`;
      await api(
        admin,
        `/pages/${hidden.id}/actions/access/close-user`,
        'POST',
        { userId: writer.id },
      );
      exclusions.push({ pageId: excluded.id, includeDescendants: true });
    }
    const contentPolicy = await api(admin, `/spaces/${space.id}/ai/exclusions`);
    await api(admin, `/spaces/${space.id}/ai/exclusions`, 'PUT', {
      expectedRevision: contentPolicy.revision,
      ragSearchDoneOnly: false,
      exclusions,
    });
    const providerKey = providerCapture?.token ?? 'isolated-lm-studio-no-auth';
    exactSecrets.add(providerKey);
    await api(admin, `/spaces/${space.id}/ai/config`, 'PATCH', {
      enabled: true,
      agentEnabled: false,
      provider: 'openai-compatible',
      baseUrl: providerCapture?.baseUrl ?? config.baseUrl,
      chatModel: config.model,
      apiKey: providerKey,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      contextWindow: config.contextWindow,
      requestTimeoutMs: config.requestTimeoutMs,
      reasoningEnabled: false,
      visionEnabled: false,
      dailyRequestLimitPerUser: 1000,
      dailyTokenLimitPerSpace: 10000000,
      retrieval: { adapter: 'none', url: null, qualityProfile: 'evidence-v1' },
    });
    await api(
      admin,
      `/spaces/${space.id}/ai/config/actions/test-agent`,
      'POST',
      {},
    );
    await api(admin, `/spaces/${space.id}/ai/config`, 'PATCH', {
      agentEnabled: true,
    });
    await api(admin, '/ai/tool-policy', 'PATCH', {
      enabled: true,
      readOnly: false,
      knowledgeOnly: false,
      allowedCapabilities: [
        'database.context.read',
        'database.rows.read',
        'database.row_context.read',
        'database.view.query',
        'database.summary.read',
        'database.cells.propose',
      ],
    });
    await writeFile(
      path.join(output, 'quality-configuration.json'),
      JSON.stringify(
        {
          ...config,
          sharedArtifactSha256: report.sharedArtifactSha256 ?? null,
          providerCaptureOrigin: providerCapture?.origin ?? null,
          providerCaptureFile: providerCapture
            ? 'quality-provider-requests.jsonl'
            : null,
          serverArtifactSha256: await artifactHash(
            path.join(output, 'runtime/apps/server/dist'),
          ),
          packageLockSha256: createHash('sha256')
            .update(
              await readFile(
                new URL('../../../pnpm-lock.yaml', import.meta.url),
              ),
            )
            .digest('hex'),
          hardware: {
            cpu: cpus()[0]?.model ?? null,
            logicalCpus: cpus().length,
            memoryBytes: totalmem(),
            arch: process.arch,
            platform: process.platform,
          },
          warmup:
            'capabilityProbe completed; provider cache state is not controlled',
          corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
          questionIds: questions.map((question) => question.id),
          concurrency: 1,
          source: 'real server tool steps and durable run snapshots',
          humanReview: 'pending',
        },
        null,
        2,
      ),
    );
    const recordsPath = path.join(output, 'quality-runs.jsonl');
    await writeFile(recordsPath, '');
    const results = [];
    for (const question of questions) {
      const started = performance.now();
      providerCapture?.setCase(question.id);
      const databaseId = question.databaseContext.databaseId;
      const conversation = await api(writer, '/ai/conversations', 'POST', {
        pageId: databaseId,
        clientRequestId: randomUUID(),
        title: question.id,
        useSpaceSearch: false,
        agentMode: true,
      });
      const context = await api(
        writer,
        `/ai/conversations/${conversation.id}/context`,
      );
      const snapshot = fixtures.find(
        (fixture) => fixture.databaseId === databaseId,
      ).name;
      const sent = await api(
        writer,
        `/ai/conversations/${conversation.id}/messages`,
        'POST',
        {
          content: question.question,
          clientRequestId: randomUUID(),
          contextRevision: context.revision,
          documentSnapshot: snapshot,
          snapshotHash: createHash('sha256').update(snapshot).digest('hex'),
          documentHeadings: [],
          useSpaceSearch: false,
          databaseContext: question.databaseContext,
        },
      );
      let run;
      const deadline = Date.now() + 1800000;
      console.log(`Quality ${question.id}: started ${sent.run.id}`);
      do {
        run = await api(writer, `/ai/runs/${sent.run.id}`);
        if (
          ['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(
            run.status,
          )
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } while (Date.now() < deadline);
      const [persisted] =
        await sql`select response_snapshot,evidence_snapshot,retrieval_diagnostics,input_tokens,output_tokens,error_code from ai_runs where id=${run.id}`;
      const toolCalls =
        await sql`select id,tool_name as name,arguments,result,write_class as "writeClass",status from ai_run_steps where run_id=${run.id} order by sequence`;
      const totalMs = Math.round(performance.now() - started);
      const auditStarted = performance.now();
      const expectedCall = toolCalls.findLast(
        (call) => call.name === question.databaseExpectation.tool,
      );
      if (
        question.databaseExpectation.pageIds &&
        expectedCall?.result?.receipt?.version === 1
      ) {
        try {
          const pageIds = [];
          const cursors = new Set();
          let cursor;
          for (let page = 0; page <= Math.ceil(300 / 25) + 1; page++) {
            const response = await api(
              writer,
              `/ai/runs/${run.id}/steps/${expectedCall.id}/database-result${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`,
            );
            pageIds.push(...response.items.map((row) => row.pageId));
            if (!response.hasMore) {
              expectedCall.observedSelectionPageIds = pageIds;
              expectedCall.observedSelectionComplete = true;
              break;
            }
            assert(
              response.nextCursor && !cursors.has(response.nextCursor),
              'Selection audit cursor did not progress',
            );
            cursors.add(response.nextCursor);
            cursor = response.nextCursor;
          }
        } catch (error) {
          expectedCall.selectionAuditError = String(error.message).slice(
            0,
            1200,
          );
        }
      }
      const providerRequests = providerCapture
        ? await providerCapture.takeCase(question.id)
        : [];
      const answer = persisted.response_snapshot ?? '';
      const transmittedSegments = providerTextSegments(providerRequests);
      const evidence = (persisted.evidence_snapshot?.sources ?? []).map(
        (source) => ({
          sourceId: source.sourceId,
          marker: source.marker,
          text: source.excerpt ?? '',
          version: source.sourceVersion ?? null,
          verification:
            'immutable synthetic document snapshot; actual provider transmission',
          readable:
            ['completed', 'awaiting_approval'].includes(run.status) &&
            source.sourceId === databaseId,
          current:
            source.sourceId === databaseId && source.excerpt === snapshot,
          transmitted: sourceWasTransmitted(
            transmittedSegments,
            source.marker,
            source.excerpt,
          ),
        }),
      );
      const record = {
        id: question.id,
        profile: 'evidence-v1',
        effectiveProfile:
          persisted.evidence_snapshot?.profile ??
          persisted.retrieval_diagnostics?.profile ??
          null,
        runId: run.id,
        status: run.status,
        candidates: [],
        evidence,
        citations: [
          ...new Set(
            [...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]),
          ),
        ],
        answer,
        refused: run.status === 'failed' ? true : null,
        preparationMs: persisted.retrieval_diagnostics?.preparationMs ?? null,
        totalMs,
        selectionAuditMs: Math.round(performance.now() - auditStarted),
        providerRequests: providerRequests.map(
          ({ sequence, requestHash, transmitted, status, transportError }) => ({
            sequence,
            requestHash,
            transmitted,
            status,
            ...(transportError ? { transportError } : {}),
          }),
        ),
        inputTokens: Number(persisted.input_tokens),
        outputTokens: Number(persisted.output_tokens),
        toolCalls,
        errorCode: persisted.error_code,
        databaseTraceCorrect: evaluateDatabaseTrace(
          question.databaseExpectation,
          toolCalls,
        ),
        review: { human: false, claims: [] },
      };
      await appendFile(recordsPath, `${JSON.stringify(record)}\n`);
      results.push({
        id: question.id,
        status: run.status,
        correct: record.databaseTraceCorrect,
        totalMs: record.totalMs,
      });
      console.log(
        `Quality ${question.id}: ${run.status}, database trace ${record.databaseTraceCorrect ? 'correct' : 'incorrect'}, ${record.totalMs} ms`,
      );
      if (run.status === 'awaiting_approval') {
        const cancelled = await api(
          writer,
          `/ai/runs/${run.id}/actions/cancel`,
          'POST',
          {},
        );
        assert.equal(cancelled.status, 'cancelled');
        await appendFile(
          path.join(output, 'quality-proposal-cleanup.jsonl'),
          `${JSON.stringify({
            id: question.id,
            runId: run.id,
            status: cancelled.status,
          })}\n`,
        );
      }
      if (
        !['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(
          run.status,
        )
      ) {
        await api(writer, `/ai/runs/${run.id}/actions/cancel`, 'POST', {});
        throw new Error('Quality run exceeded the fixed deadline');
      }
    }
    report.quality = {
      split: config.split,
      questions: results.length,
      correct: results.filter((item) => item.correct).length,
      humanReview: 'pending',
      results,
    };
    await writeFile(
      path.join(output, 'quality-summary.json'),
      JSON.stringify(report.quality, null, 2),
    );
  } finally {
    for (const context of contexts) await context.dispose();
  }
}
