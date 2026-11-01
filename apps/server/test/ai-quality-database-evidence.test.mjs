import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { projectDatabaseRowEvidence } from './ai-quality-database-evidence.mjs';

function capture() {
  const fixture = {
    databaseId: 'database',
    properties: {
      budgetId: 'budget',
      statusId: 'status',
      dateId: 'date',
      notesId: 'notes',
    },
    records: [
      {
        pageId: 'page',
        readable: true,
        aiAllowed: true,
        budget: 25,
        status: 'open',
        date: null,
        notes: null,
      },
    ],
  };
  const row = {
    id: 'row-entity',
    pageId: 'page',
    title: 'Работа 0001',
    cells: [
      { propertyId: 'budget', value: 25 },
      { propertyId: 'status', value: 'open' },
      { propertyId: 'date', value: null },
      { propertyId: 'notes', value: null },
    ],
  };
  const citation = {
    marker: '[S2]',
    sourceTitle: row.title,
    source: {
      sourceType: 'database_row',
      sourceId: row.id,
      pageId: row.pageId,
      sourceTitle: row.title,
    },
  };
  const result = {
    databaseId: fixture.databaseId,
    items: [row],
    docmostCitations: [citation],
  };
  return {
    caseId: 'case',
    fixture,
    evidence: [
      {
        sourceId: row.id,
        marker: 'S2',
        text: '',
        readable: false,
        current: false,
        transmitted: false,
      },
    ],
    toolCalls: [{ name: 'listDatabaseRows', status: 'completed', result }],
    providerRequests: [
      {
        caseId: 'case',
        transmitted: true,
        messages: [
          {
            role: 'tool',
            content: JSON.stringify({ ok: true, result }),
          },
        ],
      },
    ],
  };
}

const project = (input) => projectDatabaseRowEvidence(input)[0];

test('binds row entity citations to observed pages without changing raw captures', () => {
  const input = capture();
  const before = JSON.stringify(input);
  const result = project(input);
  assert.equal(result.sourceId, 'page');
  assert.equal(result.runtimeSourceId, 'row-entity');
  assert.equal(result.readable, true);
  assert.equal(result.current, true);
  assert.equal(result.transmitted, true);
  assert.deepEqual(JSON.parse(result.text), input.toolCalls[0].result.items[0]);
  assert.equal(JSON.stringify(input), before);
});

test('does not promote failed, foreign or unbound tool reads', () => {
  for (const mutate of [
    (input) => (input.toolCalls[0].status = 'failed'),
    (input) => (input.toolCalls[0].result.databaseId = 'other'),
    (input) => (input.toolCalls[0].result.items[0].id = 'other-row'),
    (input) =>
      (input.toolCalls[0].result.docmostCitations[0].source.pageId = 'other'),
    (input) => (input.toolCalls[0].result.docmostCitations[0].marker = '[S9]'),
  ]) {
    const input = capture();
    mutate(input);
    assert.equal(project(input).readable, false);
  }
});

test('denied, excluded and stale fixture rows remain failed evidence', () => {
  for (const flag of ['readable', 'aiAllowed']) {
    const input = capture();
    input.fixture.records[0][flag] = false;
    assert.equal(project(input).readable, false);
  }
  const changed = capture();
  changed.fixture.records[0].budget = 99;
  assert.equal(project(changed).current, false);
  assert.equal(JSON.parse(project(changed).text).cells[0].value, 25);
  const duplicate = capture();
  duplicate.toolCalls[0].result.items[0].cells[1].propertyId = 'budget';
  assert.equal(project(duplicate).current, false);
});

test('requires exact row data and its marker in one actually transmitted tool message', () => {
  for (const mutate of [
    (input) => (input.providerRequests[0].transmitted = false),
    (input) => (input.providerRequests[0].transportError = 'unavailable'),
    (input) => (input.providerRequests[0].caseId = 'other-case'),
    (input) => (input.providerRequests[0].messages[0].role = 'user'),
    (input) => (input.providerRequests[0].messages[0].content = {}),
    (input) =>
      (input.providerRequests[0].messages[0].content =
        '{"ok":true,"result":{"databaseId":"database","docmostCitations":{}}}'),
    (input) => {
      const body = JSON.parse(input.providerRequests[0].messages[0].content);
      body.result.items[0].cells[0].value = 26;
      input.providerRequests[0].messages[0].content = JSON.stringify(body);
    },
    (input) => {
      const result = input.toolCalls[0].result;
      input.providerRequests[0].messages = [
        {
          role: 'tool',
          content: JSON.stringify({
            ok: true,
            result: {
              databaseId: 'database',
              items: result.items,
            },
          }),
        },
        {
          role: 'tool',
          content: JSON.stringify({
            ok: true,
            result: {
              databaseId: 'database',
              docmostCitations: result.docmostCitations,
            },
          }),
        },
      ];
    },
  ]) {
    const input = capture();
    mutate(input);
    assert.equal(project(input).transmitted, false);
  }
});

function replayFiles(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'docmost-row-evidence-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert(path.basename(directory).startsWith('docmost-row-evidence-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const captured = capture();
  const corpus = JSON.stringify({
    databaseFixtures: [captured.fixture],
    databaseQuestions: [
      {
        id: 'case',
        split: 'holdout',
        databaseContext: { databaseId: 'database' },
      },
    ],
  });
  const config = {
    scope: 'database',
    split: 'holdout',
    model: 'fixed-model',
    corpusSha256: createHash('sha256').update(corpus).digest('hex'),
  };
  const run = {
    id: 'case',
    answer: 'Observed answer',
    review: { human: false, claims: [] },
    evidence: captured.evidence,
    toolCalls: captured.toolCalls,
    providerRequests: [
      { sequence: 1, requestHash: 'request-hash', transmitted: true },
    ],
  };
  const provider = {
    ...captured.providerRequests[0],
    sequence: 1,
    requestHash: 'request-hash',
    model: 'fixed-model',
  };
  const files = [
    'corpus.json',
    'runs.jsonl',
    'provider.jsonl',
    'output.jsonl',
  ].map((name) => path.join(directory, name));
  writeFileSync(files[0], corpus);
  writeFileSync(files[1], JSON.stringify(run) + '\n');
  writeFileSync(files[2], JSON.stringify(provider) + '\n');
  writeFileSync(
    path.join(directory, 'quality-configuration.json'),
    JSON.stringify(config),
  );
  return { files, directory, run };
}

const replay = (files) =>
  spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, 'reproject-ai-database-evidence.mjs'),
      ...files,
    ],
    { encoding: 'utf8', windowsHide: true },
  );

test('offline replay preserves original answers and records input/output provenance', (t) => {
  const { files, run } = replayFiles(t);
  const before = files.slice(0, 3).map((file) => readFileSync(file, 'utf8'));
  const result = replay(files);
  assert.equal(result.status, 0, result.stderr);
  const projected = JSON.parse(readFileSync(files[3], 'utf8'));
  assert.equal(projected.evidence[0].sourceId, 'page');
  assert.equal(projected.evidence[0].transmitted, true);
  assert.deepEqual({ ...projected, evidence: [] }, { ...run, evidence: [] });
  assert.deepEqual(
    files.slice(0, 3).map((file) => readFileSync(file, 'utf8')),
    before,
  );
  const provenance = JSON.parse(
    readFileSync(files[3] + '.projection.json', 'utf8'),
  );
  assert.equal(provenance.changedSources, 1);
  assert.equal(provenance.inference, 'not repeated');
  assert.equal(
    provenance.output.sha256,
    createHash('sha256').update(readFileSync(files[3])).digest('hex'),
  );
  assert.notEqual(replay(files).status, 0);
});

test('offline replay rejects changed corpora, mismatched captures and input overwrite', (t) => {
  for (const kind of ['corpus', 'provider', 'overwrite']) {
    const { files } = replayFiles(t);
    if (kind === 'corpus')
      writeFileSync(files[0], readFileSync(files[0], 'utf8') + ' ');
    if (kind === 'provider') {
      const request = JSON.parse(readFileSync(files[2], 'utf8'));
      request.requestHash = 'different';
      writeFileSync(files[2], JSON.stringify(request) + '\n');
    }
    const runBytes = readFileSync(files[1], 'utf8');
    const result = replay(
      kind === 'overwrite' ? [files[0], files[1], files[2], files[1]] : files,
    );
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(files[3]), false);
    assert.equal(readFileSync(files[1], 'utf8'), runBytes);
  }
});
