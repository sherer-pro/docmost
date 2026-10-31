import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { request } from '../../client/e2e/database/api-context.mjs';
import { artifactHash } from './ai-database-quality-live.mjs';
import {
  providerTextSegments,
  sourceWasTransmitted,
} from './ai-quality-transmission.mjs';

// This adversarial adapter supplies only the case's deliberately stale hit.
// Ordinary ranking is the application's actual local search, without an oracle.
export async function createQualityStaleIndex() {
  const token = randomBytes(32).toString('base64url');
  let items = [];
  const server = createServer(async (req, res) => {
    if (
      req.method !== 'POST' ||
      req.url !== '/retrieve' ||
      req.headers.authorization !== `Bearer ${token}`
    ) {
      res.writeHead(403).end();
      return;
    }
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 65536) {
        res.writeHead(413).end();
        return;
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ items }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = {
    origin,
    url: `${origin}/retrieve`,
    setItems: (value) => {
      items = value;
    },
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
  Object.defineProperty(result, 'token', { value: token });
  return result;
}

export async function runRagQuality({
  baseURL,
  sql,
  output,
  exactSecrets,
  report,
  config,
  providerCapture,
  staleIndex,
}) {
  const corpusBytes = await readFile(
    new URL('../../../tests/rag-quality/corpus.json', import.meta.url),
  );
  const corpus = JSON.parse(corpusBytes);
  let questions = corpus.questions.filter(
    (question) => question.split === config.split,
  );
  if (config.limit) questions = questions.slice(0, config.limit);
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
      name: 'RAG Quality Administrator',
      email: 'rag-admin@example.test',
      password: password(),
      workspaceName: 'Isolated RAG quality',
      hostname: `ragquality${Date.now()}`,
    });
    admin.id = (await api(admin, '/users/me')).user.id;
    const email = 'rag-reader@example.test';
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
    const reader = await actor();
    await api(reader, '/workspace/invites/accept', 'POST', {
      invitationId: invite.id,
      token,
      name: 'RAG Quality Reader',
      password: password(),
    });
    reader.id = (await api(reader, '/users/me')).user.id;
    const space = await api(admin, '/spaces', 'POST', {
      name: 'RAG corpus',
      slug: `rag${randomBytes(4).toString('hex')}`,
    });
    await api(admin, `/spaces/${space.id}`, 'PATCH', {
      dictionaryEnabled: true,
    });
    await api(admin, '/spaces/members/add', 'POST', {
      spaceId: space.id,
      userIds: [reader.id],
      groupIds: [],
      role: 'writer',
    });
    const destination = await api(admin, '/spaces', 'POST', {
      name: 'Policy destination',
      slug: `policy${randomBytes(4).toString('hex')}`,
    });
    // The actor belongs to both spaces: a move tests scope independently of ACL.
    await api(admin, '/spaces/members/add', 'POST', {
      spaceId: destination.id,
      userIds: [reader.id],
      groupIds: [],
      role: 'reader',
    });
    const root = await api(admin, '/pages', 'POST', {
      spaceId: space.id,
      title: 'Quality conversation',
      settings: { status: 'DONE' },
    });
    const database = await api(admin, '/databases', 'POST', {
      spaceId: space.id,
      name: 'Commercial conditions',
    });
    await api(admin, '/pages/actions/update', 'POST', {
      pageId: database.pageId,
      customFields: { status: 'DONE' },
    });
    const mapping = new Map();
    const aliases = new Map();
    for (const document of corpus.documents) {
      let source;
      if (document.sourceType === 'dictionary_term') {
        const term = await api(admin, '/dictionary-terms', 'POST', {
          spaceId: space.id,
          term: document.title,
          forms: document.forms,
          definitionMarkdown: document.markdown,
        });
        source = {
          sourceType: 'dictionary_term',
          sourceId: term.id,
          pageId: null,
        };
      } else if (document.sourceType === 'database_row') {
        const row = await api(admin, `/databases/${database.id}/rows`, 'POST', {
          title: document.title,
        });
        await api(admin, '/pages/actions/update', 'POST', {
          pageId: row.pageId,
          content: document.markdown,
          format: 'markdown',
          operation: 'replace',
          customFields: { status: 'DONE' },
        });
        source = {
          sourceType: 'database_row',
          sourceId: row.id,
          pageId: row.pageId,
        };
        aliases.set(row.pageId, document.id);
      } else {
        const page = await api(admin, '/pages', 'POST', {
          spaceId: space.id,
          title: document.title,
          ...(document.sourceType === 'attachment'
            ? {}
            : { content: document.markdown, format: 'markdown' }),
          settings: { status: 'DONE' },
        });
        source = { sourceType: 'page', sourceId: page.id, pageId: page.id };
        if (document.sourceType === 'attachment') {
          const csrf = (await admin.api.storageState()).cookies.find(
            (cookie) => cookie.name === 'csrfToken',
          )?.value;
          const response = await admin.api.post(
            `/api/attachments/actions/upload-file?pageId=${page.id}`,
            {
              headers: { 'x-csrf-token': csrf },
              multipart: {
                pageId: page.id,
                file: {
                  name: `${document.id}.md`,
                  mimeType: 'text/markdown',
                  buffer: Buffer.from(document.markdown),
                },
              },
            },
          );
          assert(
            response.ok(),
            `Fixture attachment upload failed: ${response.status()}`,
          );
          const payload = await response.json();
          const file = payload.data ?? payload;
          source = {
            sourceType: 'attachment',
            sourceId: file.id,
            pageId: page.id,
          };
        }
        if (!document.readable)
          await api(
            admin,
            `/pages/${page.id}/actions/access/close-user`,
            'POST',
            { userId: reader.id },
          );
      }
      assert(source.sourceId, `Missing source ID for ${document.id}`);
      mapping.set(document.id, { ...source, fixture: document });
      aliases.set(source.sourceId, document.id);
    }
    await writeFile(
      path.join(output, 'quality-source-map.json'),
      JSON.stringify(
        [...mapping].map(([fixtureId, source]) => ({ fixtureId, ...source })),
        null,
        2,
      ),
    );
    const searchReadiness = [];
    for (const document of corpus.documents.filter(
      (item) => item.sourceType === 'page' && item.readable,
    )) {
      const query = document.title.split(':')[0];
      const source = mapping.get(document.id);
      const deadline = Date.now() + 15000;
      let items = [];
      do {
        items = (
          await api(reader, '/search', 'POST', { query, spaceId: space.id })
        ).items;
        if (items.some((item) => item.id === source.pageId)) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      } while (Date.now() < deadline);
      assert(
        items.some((item) => item.id === source.pageId),
        `Guide did not become searchable: ${document.id}`,
      );
      searchReadiness.push({
        query,
        sourceId: source.pageId,
        pageIds: items.map((item) => item.id),
      });
    }
    const firstNaturalQuery = (
      await api(reader, '/search', 'POST', {
        query: questions[0].question,
        spaceId: space.id,
      })
    ).items;
    await writeFile(
      path.join(output, 'quality-search-readiness.json'),
      JSON.stringify(
        {
          indexedGuides: searchReadiness,
          firstNaturalQuery: questions[0].question,
          naturalQueryPageIds: firstNaturalQuery.map((item) => item.id),
        },
        null,
        2,
      ),
    );
    const policy = await api(admin, `/spaces/${space.id}/ai/exclusions`);
    await api(admin, `/spaces/${space.id}/ai/exclusions`, 'PUT', {
      expectedRevision: policy.revision,
      ragSearchDoneOnly: true,
      exclusions: [],
    });
    await api(admin, `/spaces/${space.id}/ai/config`, 'PATCH', {
      enabled: true,
      agentEnabled: false,
      provider: 'openai-compatible',
      baseUrl: providerCapture.baseUrl,
      chatModel: config.model,
      apiKey: providerCapture.token,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      contextWindow: config.contextWindow,
      requestTimeoutMs: config.requestTimeoutMs,
      reasoningEnabled: false,
      visionEnabled: false,
      dailyRequestLimitPerUser: 1000,
      dailyTokenLimitPerSpace: 10000000,
      retrieval: {
        adapter: 'http-json-v1',
        url: staleIndex.url,
        apiKey: staleIndex.token,
        qualityProfile: 'evidence-v1',
        maxResults: 20,
        followUpRewriteEnabled: true,
      },
    });
    await writeFile(
      path.join(output, 'quality-configuration.json'),
      JSON.stringify(
        {
          ...config,
          corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
          sharedArtifactSha256: report.sharedArtifactSha256,
          serverArtifactSha256: await artifactHash(
            path.join(output, 'runtime/apps/server/dist'),
          ),
          questionIds: questions.map((question) => question.id),
          source:
            'actual local ranking, canonical loads and captured provider requests; external adapter injects stale hits only',
          concurrency: 1,
          humanReview: 'pending',
        },
        null,
        2,
      ),
    );
    const recordsPath = path.join(output, 'quality-runs.jsonl');
    await writeFile(recordsPath, '');
    const results = [];
    const send = async (conversation, content) => {
      const context = await api(
        reader,
        `/ai/conversations/${conversation.id}/context`,
      );
      const sent = await api(
        reader,
        `/ai/conversations/${conversation.id}/messages`,
        'POST',
        {
          content,
          clientRequestId: randomUUID(),
          contextRevision: context.revision,
          documentSnapshot: '',
          snapshotHash: createHash('sha256').update('').digest('hex'),
          documentHeadings: [],
          useSpaceSearch: true,
        },
      );
      const deadline = Date.now() + 900000;
      let run;
      do {
        run = await api(reader, `/ai/runs/${sent.run.id}`);
        if (['completed', 'failed', 'cancelled'].includes(run.status))
          return run;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } while (Date.now() < deadline);
      await api(reader, `/ai/runs/${sent.run.id}/actions/cancel`, 'POST', {});
      throw new Error('RAG quality run exceeded the fixed deadline');
    };
    for (const question of questions) {
      const started = performance.now();
      providerCapture.setCase(question.id);
      const caseAliases = new Map(aliases);
      let probe;
      let stale = question.staleIndex
        ? mapping.get(question.staleIndex.sourceId)
        : null;
      if (question.policyMutation) {
        // Keep the original secret private; this probe tests one additional guard.
        probe = await api(admin, '/pages', 'POST', {
          spaceId: space.id,
          title: stale.fixture.title,
          content: stale.fixture.markdown,
          format: 'markdown',
          settings: { status: 'DONE' },
        });
        await api(reader, `/pages/info?pageId=${probe.id}`);
        stale = { sourceType: 'page', sourceId: probe.id, pageId: probe.id };
        caseAliases.set(probe.id, question.staleIndex.sourceId);
        if (question.policyMutation === 'revoke_acl')
          await api(
            admin,
            `/pages/${probe.id}/actions/access/close-user`,
            'POST',
            { userId: reader.id },
          );
        else if (question.policyMutation === 'delete')
          await api(admin, '/pages/actions/delete', 'POST', {
            pageId: probe.id,
          });
        else if (question.policyMutation === 'move_space')
          await api(admin, '/pages/move-to-space', 'POST', {
            pageId: probe.id,
            spaceId: destination.id,
          });
        else if (question.policyMutation === 'status_not_DONE')
          await api(admin, '/pages/actions/update', 'POST', {
            pageId: probe.id,
            customFields: { status: 'IN_PROGRESS' },
          });
        else if (question.policyMutation === 'exclude') {
          const current = await api(admin, `/spaces/${space.id}/ai/exclusions`);
          await api(admin, `/spaces/${space.id}/ai/exclusions`, 'PUT', {
            expectedRevision: current.revision,
            ragSearchDoneOnly: true,
            exclusions: [{ pageId: probe.id, includeDescendants: false }],
          });
        } else throw new Error('Unknown fixture policy mutation');
      }
      staleIndex.setItems(
        stale
          ? [
              {
                sourceType: stale.sourceType,
                sourceId: stale.sourceId,
                pageId: stale.pageId,
                text: question.staleIndex.text,
              },
            ]
          : [],
      );
      const conversation = await api(reader, '/ai/conversations', 'POST', {
        pageId: root.id,
        clientRequestId: randomUUID(),
        title: question.id,
        useSpaceSearch: true,
        agentMode: false,
      });
      const initial = await api(
        reader,
        `/ai/conversations/${conversation.id}/context`,
      );
      await api(reader, `/ai/conversations/${conversation.id}/context`, 'PUT', {
        expectedRevision: initial.revision,
        includeCurrentDocument: false,
        sources: [],
        fileIds: [],
        attachmentIds: [],
      });
      console.log(`RAG quality ${question.id}: started`);
      if (question.history?.length)
        providerCapture.setCase(`${question.id}-history`);
      for (const message of question.history ?? []) {
        assert(message.role === 'user', 'Unsupported fixture history role');
        await send(conversation, message.content);
      }
      if (question.history?.length) {
        await providerCapture.takeCase(`${question.id}-history`);
        providerCapture.setCase(question.id);
      }
      const run = await send(conversation, question.question);
      const [persisted] =
        await sql`select root_run_id,attempt_no,response_snapshot,evidence_snapshot,retrieval_diagnostics,input_tokens,output_tokens,error_code from ai_runs where id=${run.id}`;
      const observations = (
        await readFile(
          path.join(output, 'quality-retrieval-trace.jsonl'),
          'utf8',
        )
      )
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter(
          (item) =>
            item.requestId ===
            `${persisted.root_run_id}-${persisted.attempt_no}`,
        );
      const ranked =
        observations.findLast((item) => item.phase === 'ranked_candidates')
          ?.data ?? [];
      const documents = new Map(
        observations
          .filter(
            (item) => item.phase === 'canonical_document' && item.data.document,
          )
          .map((item) => [
            `${item.data.hit.sourceType}:${item.data.hit.sourceId}`,
            item.data.document,
          ]),
      );
      const providerRequests = await providerCapture.takeCase(question.id);
      const transmitted = providerTextSegments(providerRequests);
      const evidence = (persisted.evidence_snapshot?.sources ?? []).map(
        (source) => {
          const document = documents.get(
            `${source.sourceType}:${source.sourceId}`,
          );
          return {
            sourceId: caseAliases.get(source.sourceId) ?? source.sourceId,
            runtimeSourceId: source.sourceId,
            marker: source.marker,
            text: source.excerpt ?? '',
            version: source.sourceVersion ?? null,
            readable: Boolean(document),
            current: Boolean(
              document && source.sourceVersion === document.version,
            ),
            transmitted: sourceWasTransmitted(
              transmitted,
              source.marker,
              source.excerpt,
            ),
            root: source.root,
          };
        },
      );
      const answer = persisted.response_snapshot ?? '';
      const record = {
        id: question.id,
        profile: 'evidence-v1',
        effectiveProfile: persisted.evidence_snapshot?.profile ?? null,
        runId: run.id,
        status: run.status,
        candidates: ranked.map((hit) => ({
          sourceId: caseAliases.get(hit.sourceId) ?? hit.sourceId,
          runtimeSourceId: hit.sourceId,
          sourceType: hit.sourceType,
          text: hit.local
            ? (documents.get(`${hit.sourceType}:${hit.sourceId}`)?.markdown ??
              '')
            : hit.text,
          canonicalObserved: documents.has(`${hit.sourceType}:${hit.sourceId}`),
        })),
        evidence,
        citations: [
          ...new Set(
            [...answer.matchAll(/\[(S\d+)\]/g)].map((match) => match[1]),
          ),
        ],
        answer,
        refused: run.status === 'failed' ? true : null,
        preparationMs: persisted.retrieval_diagnostics?.preparationMs ?? null,
        totalMs: Math.round(performance.now() - started),
        inputTokens: Number(persisted.input_tokens),
        outputTokens: Number(persisted.output_tokens),
        errorCode: persisted.error_code,
        policyMutation: question.policyMutation ?? null,
        observationCount: observations.length,
        providerRequests: providerRequests.map(
          ({ sequence, requestHash, transmitted, status }) => ({
            sequence,
            requestHash,
            transmitted,
            status,
          }),
        ),
        review: { human: false, claims: [] },
      };
      await appendFile(recordsPath, `${JSON.stringify(record)}\n`);
      results.push({
        id: question.id,
        status: run.status,
        totalMs: record.totalMs,
        candidateCount: ranked.length,
        evidenceCount: evidence.length,
      });
      console.log(
        `RAG quality ${question.id}: ${run.status}, ${ranked.length} actual candidates, ${evidence.length} evidence sources, ${record.totalMs} ms`,
      );
      staleIndex.setItems([]);
      if (question.policyMutation === 'exclude') {
        const current = await api(admin, `/spaces/${space.id}/ai/exclusions`);
        await api(admin, `/spaces/${space.id}/ai/exclusions`, 'PUT', {
          expectedRevision: current.revision,
          ragSearchDoneOnly: true,
          exclusions: [],
        });
      }
      if (probe && question.policyMutation !== 'delete')
        await api(admin, '/pages/actions/delete', 'POST', { pageId: probe.id });
    }
    report.quality = {
      scope: 'rag',
      split: config.split,
      questions: results.length,
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
