import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  projectRagTransmission,
  reprojectRagFiles,
} from './reproject-ai-rag-transmission.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(
  new URL('./reproject-ai-rag-transmission.mjs', import.meta.url),
);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = (value) =>
  Buffer.from(JSON.stringify(value, null, 2) + '\r\n');
const lines = (values) =>
  Buffer.from(values.map((value) => JSON.stringify(value)).join('\n') + '\n');
const text = '# Terms\n\nThe minimum term is 12 months.';
const otherText = '# Quota\n\nThe limit is 200 requests.';
const frame = (content) =>
  `UNTRUSTED_REFERENCE_DATA_JSON\n${JSON.stringify([{ reference: 1, content }])}\nEND_UNTRUSTED_REFERENCE_DATA_JSON\nUSER_REQUEST\nAnswer the question.`;

function fixture() {
  const corpus = {
    version: 5,
    documents: [],
    questions: [
      { id: 'q001', split: 'holdout' },
      { id: 'q002', split: 'holdout' },
    ],
    databaseQuestions: [],
  };
  const config = {
    scope: 'rag',
    split: 'holdout',
    model: 'selected-model',
    limit: 0,
    questionIds: ['q001', 'q002'],
  };
  const requests = [
    {
      caseId: 'q001',
      sequence: 11,
      model: config.model,
      requestHash: 'a'.repeat(64),
      status: 200,
      transmitted: true,
      transportError: true,
      messages: [
        { content: frame(`[S1] Terms\n${text}`) },
        {
          content: JSON.stringify({ label: '[S2]', unrelated: 'Not joined.' }),
        },
      ],
    },
    {
      caseId: 'q002',
      sequence: 12,
      model: config.model,
      requestHash: 'b'.repeat(64),
      status: 200,
      transmitted: true,
      messages: [{ content: frame(`[S1] Quota\n${otherText}`) }],
    },
  ];
  const runs = [
    {
      id: 'q001',
      runId: 'run-one',
      profile: 'evidence-v1',
      status: 'completed',
      answer: 'Twelve months [S1].',
      citations: ['S1'],
      preparationMs: 123,
      refused: null,
      review: { human: false, claims: [], note: 'Keep this note.' },
      providerRequests: [
        {
          sequence: 11,
          requestHash: requests[0].requestHash,
          status: 200,
          transmitted: true,
        },
      ],
      evidence: [
        {
          sourceId: 'terms',
          marker: 'S1',
          text,
          readable: true,
          current: true,
          transmitted: false,
          extra: { original: true },
        },
        {
          sourceId: 'unjoined',
          marker: 'S2',
          text: 'Not joined.',
          readable: true,
          current: true,
          transmitted: false,
        },
        {
          sourceId: 'other-case',
          marker: 'S3',
          text: otherText,
          readable: false,
          current: false,
          transmitted: false,
        },
      ],
    },
    {
      id: 'q002',
      runId: 'run-two',
      profile: 'evidence-v1',
      status: 'completed',
      answer: 'Two hundred requests [S1].',
      citations: ['S1'],
      preparationMs: 456,
      refused: false,
      review: {
        human: true,
        claims: [{ text: 'A preserved annotation.', supported: false }],
      },
      providerRequests: [
        {
          sequence: 12,
          requestHash: requests[1].requestHash,
          status: 200,
          transmitted: true,
        },
      ],
      evidence: [
        {
          sourceId: 'quota',
          marker: 'S1',
          text: otherText,
          readable: true,
          current: true,
          transmitted: true,
        },
      ],
    },
  ];
  return { corpus, config, requests, runs };
}
function buffers(value) {
  const corpusBytes = jsonBytes(value.corpus);
  return {
    corpusBytes,
    configBytes: jsonBytes({
      ...value.config,
      corpusSha256: value.config.corpusSha256 ?? hash(corpusBytes),
    }),
    runsBytes: lines(value.runs),
    providerBytes: lines(value.requests),
  };
}

test('projects only exact per-case evidence transmission and preserves answers and human annotations', () => {
  const value = fixture();
  const input = buffers(value);
  const originalInput = Object.fromEntries(
    Object.entries(input).map(([key, bytes]) => [key, hash(bytes)]),
  );
  const result = projectRagTransmission(input);
  const expected = structuredClone(value.runs);
  expected[0].evidence[0].transmitted = true;
  assert.deepEqual(result.projected, expected);
  assert.equal(result.changedSources, 1);
  assert.deepEqual(result.changedCases, ['q001']);
  assert.deepEqual(
    value.runs[0].evidence.map((source) => source.transmitted),
    [false, false, false],
  );
  for (const [key, bytes] of Object.entries(input))
    assert.equal(hash(bytes), originalInput[key]);
});

test('keeps failed or unconfirmed input delivery and absent or altered text failed', () => {
  for (const [status, transmitted] of [
    [400, true],
    [null, true],
    [200, false],
  ]) {
    const value = fixture();
    Object.assign(value.requests[0], { status, transmitted });
    Object.assign(value.runs[0].providerRequests[0], { status, transmitted });
    assert.equal(
      projectRagTransmission(buffers(value)).projected[0].evidence[0]
        .transmitted,
      false,
    );
  }
  for (const content of [
    frame(`[S9] Terms\n${text}`),
    frame(`[S1] Terms\n${text.replace('12', '6')}`),
    '',
    '[S1]',
  ]) {
    const value = fixture();
    value.requests[0].messages = [{ content }];
    assert.equal(
      projectRagTransmission(buffers(value)).projected[0].evidence[0]
        .transmitted,
      false,
    );
  }
});

test('rejects corpus, configuration, sequence and exact provider-reference mismatches', () => {
  const mutations = [
    [
      'scope',
      (value) => {
        value.config.scope = 'database';
      },
    ],
    [
      'corpus hash',
      (value) => {
        value.config.corpusSha256 = '0'.repeat(64);
      },
    ],
    [
      'configuration split',
      (value) => {
        value.config.split = 'tuning';
      },
    ],
    [
      'partial scope',
      (value) => {
        value.config.limit = 1;
      },
    ],
    [
      'configured IDs',
      (value) => {
        value.config.questionIds = ['q001'];
      },
    ],
    [
      'duplicate capture',
      (value) => {
        value.runs[1].id = 'q001';
      },
    ],
    [
      'unknown capture',
      (value) => {
        value.runs[1].id = 'q003';
      },
    ],
    [
      'missing capture',
      (value) => {
        value.runs.pop();
      },
    ],
    [
      'model',
      (value) => {
        value.requests[0].model = 'other-model';
      },
    ],
    [
      'case',
      (value) => {
        value.requests[0].caseId = 'q002';
      },
    ],
    [
      'history case',
      (value) => {
        value.requests[0].caseId = 'q001-history';
      },
    ],
    [
      'hash',
      (value) => {
        value.runs[0].providerRequests[0].requestHash = 'c'.repeat(64);
      },
    ],
    [
      'invalid hash',
      (value) => {
        value.requests[0].requestHash = 'bad';
      },
    ],
    [
      'sequence',
      (value) => {
        value.runs[0].providerRequests[0].sequence = 99;
      },
    ],
    [
      'duplicate sequence',
      (value) => {
        value.requests[1].sequence = 11;
      },
    ],
    [
      'duplicate reference',
      (value) => {
        value.runs[0].providerRequests.push({
          ...value.runs[0].providerRequests[0],
        });
      },
    ],
    [
      'status',
      (value) => {
        value.runs[0].providerRequests[0].status = 400;
      },
    ],
    [
      'missing status',
      (value) => {
        delete value.requests[0].status;
      },
    ],
    [
      'delivery',
      (value) => {
        value.runs[0].providerRequests[0].transmitted = false;
      },
    ],
    [
      'missing frame',
      (value) => {
        value.requests.shift();
      },
    ],
    [
      'missing references',
      (value) => {
        value.runs[0].providerRequests = [];
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const value = fixture();
    mutate(value);
    assert.throws(
      () => projectRagTransmission(buffers(value)),
      { name: 'Error' },
      name,
    );
  }
});

test('binds the corpus to exact bytes including line endings', () => {
  const input = buffers(fixture());
  input.corpusBytes = Buffer.from(
    input.corpusBytes.toString().replaceAll('\r\n', '\n'),
  );
  assert.throws(
    () => projectRagTransmission(input),
    /Captured corpus bytes changed/,
  );
});

async function files(t) {
  const root = path.resolve(os.tmpdir());
  const directory = await mkdtemp(path.join(root, 'docmost-rag-replay-'));
  t.after(async () => {
    // Remove only the uniquely created test directory inside the temp root.
    assert.equal(path.dirname(path.resolve(directory)), root);
    assert(path.basename(directory).startsWith('docmost-rag-replay-'));
    await rm(directory, { recursive: true, force: true });
  });
  const input = buffers(fixture());
  const paths = {
    corpusPath: path.join(directory, 'corpus.json'),
    runsPath: path.join(directory, 'quality-runs.jsonl'),
    providerPath: path.join(directory, 'quality-provider-requests.jsonl'),
    outputPath: path.join(directory, 'derived.jsonl'),
  };
  await Promise.all([
    writeFile(paths.corpusPath, input.corpusBytes, { flag: 'wx' }),
    writeFile(paths.runsPath, input.runsBytes, { flag: 'wx' }),
    writeFile(paths.providerPath, input.providerBytes, { flag: 'wx' }),
    writeFile(
      path.join(directory, 'quality-configuration.json'),
      input.configBytes,
      { flag: 'wx' },
    ),
  ]);
  return { directory, input, paths };
}

test('CLI writes separate provenance with checksums and refuses every existing output', async (t) => {
  const { directory, input, paths } = await files(t);
  const args = [
    script,
    paths.corpusPath,
    paths.runsPath,
    paths.providerPath,
    paths.outputPath,
  ];
  const result = await exec(process.execPath, args, {
    cwd: directory,
    windowsHide: true,
  });
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.records, 2);
  assert.equal(summary.changedSources, 1);
  const output = await readFile(paths.outputPath);
  const provenance = JSON.parse(
    await readFile(paths.outputPath + '.projection.json', 'utf8'),
  );
  assert.equal(provenance.output.sha256, hash(output));
  assert.deepEqual(
    provenance.inputs.map((item) => item.sha256),
    [
      input.corpusBytes,
      input.runsBytes,
      input.providerBytes,
      input.configBytes,
    ].map(hash),
  );
  assert.deepEqual(provenance.changedFields, ['evidence[].transmitted']);
  assert.equal(provenance.humanReview, 'unchanged');
  assert.equal(provenance.inference, 'not repeated');
  assert.equal(
    provenance.observer.file,
    fileURLToPath(new URL('./ai-quality-transmission.mjs', import.meta.url)),
  );
  await assert.rejects(
    exec(process.execPath, args, { cwd: directory, windowsHide: true }),
  );
  assert.equal(hash(await readFile(paths.outputPath)), hash(output));
  assert.equal(hash(await readFile(paths.runsPath)), hash(input.runsBytes));
  assert.equal(
    hash(await readFile(paths.providerPath)),
    hash(input.providerBytes),
  );
});

test('CLI refuses input collisions and preexisting provenance before creating any output', async (t) => {
  const { input, paths } = await files(t);
  await assert.rejects(
    reprojectRagFiles({ ...paths, outputPath: paths.runsPath }),
    /differ from every input/,
  );
  await writeFile(paths.outputPath + '.projection.json', 'Keep provenance.', {
    flag: 'wx',
  });
  await assert.rejects(reprojectRagFiles(paths), /output already exists/);
  await assert.rejects(access(paths.outputPath));
  assert.equal(
    (await readFile(paths.outputPath + '.projection.json')).toString(),
    'Keep provenance.',
  );
  assert.equal(hash(await readFile(paths.runsPath)), hash(input.runsBytes));
});

test('CLI rejects a bad reference without outputs and does not print source content', async (t) => {
  const { directory, paths } = await files(t);
  const value = fixture();
  value.runs[0].providerRequests[0].status = 400;
  await writeFile(paths.runsPath, lines(value.runs));
  let failure;
  try {
    await exec(
      process.execPath,
      [
        script,
        paths.corpusPath,
        paths.runsPath,
        paths.providerPath,
        paths.outputPath,
      ],
      { cwd: directory, windowsHide: true },
    );
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 1);
  assert.match(failure.stderr, /Provider capture reference does not match/);
  assert(!failure.stderr.includes(text));
  assert.equal(failure.stdout, '');
  await assert.rejects(access(paths.outputPath));
  await assert.rejects(access(paths.outputPath + '.projection.json'));
});
