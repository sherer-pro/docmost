import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';

export async function runAiDatabaseAcceptance({
  api,
  fetchApi,
  actors,
  space,
  database,
  properties,
  ids,
  state,
  providerURL,
  test,
  sql,
  exactSecrets,
  report,
}) {
  const admin = actors.admin;
  const capabilities = [
    'database.view.query',
    'database.summary.read',
    'database.cells.propose',
  ];
  const policy = {
    enabled: true,
    allowedCapabilities: capabilities,
    readOnly: false,
    knowledgeOnly: false,
  };
  const key = 'synthetic-database-provider-key';
  exactSecrets.add(key);
  await api(admin, `/spaces/${space.id}/ai/config`, 'PATCH', {
    enabled: true,
    agentEnabled: false,
    provider: 'openai-compatible',
    baseUrl: providerURL,
    chatModel: 'docmost-agent-audit-v1',
    apiKey: key,
    temperature: 0,
    maxOutputTokens: 512,
    contextWindow: 32768,
    requestTimeoutMs: 30000,
    reasoningEnabled: false,
    visionEnabled: false,
    retrieval: { adapter: 'none', url: null },
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
  const effective = await api(admin, '/ai/tool-policy', 'PATCH', policy);
  assert.deepEqual(
    [...effective.effectiveCapabilities].sort(),
    [...capabilities].sort(),
  );
  const waitRun = async (actor, id, statuses) => {
    for (let i = 0; i < 100; i++) {
      const run = await api(actor, `/ai/runs/${id}`);
      if (statuses.includes(run.status)) return run;
      if (run.status === 'failed')
        throw new Error(`AI database acceptance failed: ${run.errorCode}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('AI database acceptance timed out');
  };
  const start = async (
    actor,
    scenario,
    propertyId,
    pageIds = [],
    viewState = state,
    groupKey,
  ) => {
    const conversation = await api(actor, '/ai/conversations', 'POST', {
      pageId: database.pageId,
      clientRequestId: randomUUID(),
      title: scenario,
      useSpaceSearch: false,
      agentMode: true,
    });
    const context = await api(
      actor,
      `/ai/conversations/${conversation.id}/context`,
    );
    const content = `AGENT_AUDIT:${scenario}\nDATABASE_AUDIT_CONTEXT:${JSON.stringify({ databaseId: database.id, propertyId, pageIds, value: 'b' })}`;
    const sent = await api(
      actor,
      `/ai/conversations/${conversation.id}/messages`,
      'POST',
      {
        content,
        clientRequestId: randomUUID(),
        contextRevision: context.revision,
        documentSnapshot: 'Database acceptance',
        snapshotHash: createHash('sha256')
          .update('Database acceptance')
          .digest('hex'),
        documentHeadings: [],
        useSpaceSearch: false,
        databaseContext: {
          databaseId: database.id,
          viewState,
          groupKey,
          selectedPageIds: pageIds,
        },
      },
    );
    return { conversation, run: sent.run };
  };
  const status = properties[8].id,
    amount = properties[1].id,
    selected = ids.slice(150, 152);
  const statuses = async () =>
    sql`select page_id,value,revision from database_cells where database_id=${database.id}::uuid and page_id=any(${selected}::uuid[]) and property_id=${status}::uuid order by page_id`;
  await test('AI view totals cover more than 200 accessible rows and revoke stored tool results', async () => {
    const viewState = { ...state, calculations: { [amount]: 'sum' } };
    const expected = await api(
      actors.reader,
      `/databases/${database.id}/summary?${new URLSearchParams({ viewState: JSON.stringify(viewState) })}`,
    );
    const started = await start(
      actors.reader,
      'database-summary',
      amount,
      [],
      viewState,
    );
    const completed = await waitRun(actors.reader, started.run.id, [
      'completed',
    ]);
    const summaryStep = completed.steps.find(
      (step) => step.toolName === 'summarizeDatabaseView',
    );
    assert(
      summaryStep,
      `Missing summary tool; observed: ${completed.steps.map((step) => step.toolName).join(',')}`,
    );
    const result = summaryStep.result;
    assert.equal(result.count, expected.count);
    assert.equal(result.values[amount], expected.values[amount]);
    assert(result.count > 200);
    await api(admin, `/pages/${ids[152]}/actions/access/close-user`, 'POST', {
      userId: actors.reader.id,
    });
    try {
      const denied = await fetchApi(
        actors.reader,
        `/ai/runs/${started.run.id}`,
      );
      assert.equal(denied.status(), 403);
      const content = await denied.text();
      assert(!content.includes(String(expected.values[amount])));
    } finally {
      await api(admin, `/pages/${ids[152]}/actions/access/grant-user`, 'POST', {
        userId: actors.reader.id,
        role: 'reader',
      });
    }
  });
  await test('AI cell approval applies only unchanged rows and cannot be replayed', async () => {
    const before = await statuses();
    const started = await start(
      actors.editor,
      'database-write',
      status,
      selected,
    );
    const pending = await waitRun(actors.editor, started.run.id, [
      'awaiting_approval',
    ]);
    const step = pending.steps.find((s) => s.status === 'pending_approval');
    assert.equal(step.approvalPreview.kind, 'databaseCells');
    assert.equal(step.approvalPreview.rows.length, 2);
    assert.equal(step.approvalPreview.truncated, false);
    await api(
      actors.editor,
      `/databases/${database.id}/rows/${selected[0]}/cells`,
      'PATCH',
      {
        cells: [
          {
            propertyId: status,
            value: 'a',
            expectedRevision: before.find((r) => r.page_id === selected[0])
              .revision,
          },
        ],
      },
    );
    await api(
      actors.editor,
      `/ai/runs/${started.run.id}/steps/${step.id}/actions/approve`,
      'POST',
      {},
    );
    const completed = await waitRun(actors.editor, started.run.id, [
      'completed',
    ]);
    const receipt = completed.steps.find((s) => s.id === step.id).result;
    assert.deepEqual(receipt.updatedRows, [selected[1]]);
    assert.deepEqual(receipt.failedRows, [
      { pageId: selected[0], code: 'conflict' },
    ]);
    const after = await statuses();
    assert.equal(
      (
        await fetchApi(
          actors.editor,
          `/ai/runs/${started.run.id}/steps/${step.id}/actions/approve`,
          'POST',
          {},
        )
      ).status(),
      409,
    );
    assert.deepEqual(await statuses(), after);
    for (const row of after)
      await api(
        actors.editor,
        `/databases/${database.id}/rows/${row.page_id}/cells`,
        'PATCH',
        {
          cells: [
            {
              propertyId: status,
              value: before.find((r) => r.page_id === row.page_id).value,
              expectedRevision: row.revision,
            },
          ],
        },
      );
  });
  await test('AI administrator read-only mode revokes a pending database approval', async () => {
    const started = await start(
      actors.editor,
      'database-policy',
      status,
      selected,
    );
    const pending = await waitRun(actors.editor, started.run.id, [
      'awaiting_approval',
    ]);
    const step = pending.steps.find((s) => s.status === 'pending_approval');
    const before = await statuses();
    await api(admin, '/ai/tool-policy', 'PATCH', { ...policy, readOnly: true });
    const denied = await fetchApi(
      actors.editor,
      `/ai/runs/${started.run.id}/steps/${step.id}/actions/approve`,
      'POST',
      {},
    );
    assert.equal(denied.status(), 201);
    const blocked = await denied.json();
    assert.equal((blocked.data ?? blocked).run.status, 'failed');
    assert.equal(
      (blocked.data ?? blocked).run.errorCode,
      'agent_tool_policy_changed',
    );
    assert.deepEqual(await statuses(), before);
    await api(admin, '/ai/tool-policy', 'PATCH', policy);
    await api(
      actors.editor,
      `/ai/runs/${started.run.id}/actions/cancel`,
      'POST',
      {},
    );
  });
  report.aiDatabase = {
    deterministicProvider: true,
    modelQualityMeasured: false,
    completeView: true,
    partialApproval: true,
    replayProtected: true,
    revokedPolicy: true,
  };
  await test('AI summaries honor a focused group independently of the saved view', async () => {
    const view = {
      ...state,
      groupBy: properties[9].id,
      calculations: { [amount]: 'sum' },
    };
    const summary = await api(
      actors.reader,
      `/databases/${database.id}/summary?${new URLSearchParams({ viewState: JSON.stringify(view) })}`,
    );
    const group = summary.groups
      .filter((g) => g.count > 0 && g.count < summary.count)
      .sort((a, b) => a.count - b.count)[0];
    assert(group, 'The assignment fixture must contain a nonempty subset');
    const started = await start(
      actors.reader,
      'database-summary',
      amount,
      [],
      view,
      group.key,
    );
    const done = await waitRun(actors.reader, started.run.id, ['completed']);
    const result = done.steps.find(
      (step) => step.toolName === 'summarizeDatabaseView',
    ).result;
    assert.equal(result.count, group.count);
    assert.equal(result.values[amount], group.values[amount]);
    assert.equal(result.groupKey, group.key);
  });
  const ui = await start(
    actors.editor,
    'database-ui',
    status,
    ids.slice(154, 156),
  );
  const pending = await waitRun(actors.editor, ui.run.id, [
    'awaiting_approval',
  ]);
  return {
    runId: ui.run.id,
    conversationId: ui.conversation.id,
    stepId: pending.steps.find((s) => s.status === 'pending_approval').id,
  };
}
