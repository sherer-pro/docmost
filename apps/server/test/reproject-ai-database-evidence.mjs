import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { projectDatabaseRowEvidence } from './ai-quality-database-evidence.mjs';

const [corpusPath, runsPath, providerPath, outputPath] = process.argv.slice(2);
assert(
  corpusPath && runsPath && providerPath && outputPath,
  'Usage: node reproject-ai-database-evidence.mjs CORPUS.json RUNS.jsonl PROVIDER.jsonl OUTPUT.jsonl',
);
const configPath = path.join(
  path.dirname(runsPath),
  'quality-configuration.json',
);
const inputs = [corpusPath, runsPath, providerPath, configPath];
assert(
  inputs.every((file) => path.resolve(file) !== path.resolve(outputPath)),
  'Projection output must differ from every input',
);
const bytes = await Promise.all(inputs.map((file) => readFile(file)));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const jsonl = (value) =>
  value
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const corpus = JSON.parse(bytes[0]);
const runs = jsonl(bytes[1]);
const requests = jsonl(bytes[2]);
const config = JSON.parse(bytes[3]);
assert.equal(
  config.scope,
  'database',
  'Only database captures can be projected',
);
assert.equal(
  config.corpusSha256,
  hash(bytes[0]),
  'Captured corpus bytes changed',
);
assert.equal(
  new Set(runs.map((run) => run.id)).size,
  runs.length,
  'Duplicate cases',
);
const bySequence = new Map(
  requests.map((request) => [request.sequence, request]),
);
assert.equal(bySequence.size, requests.length, 'Duplicate provider sequence');
const projected = runs.map((run) => {
  const question = corpus.databaseQuestions.find((item) => item.id === run.id);
  const fixture = corpus.databaseFixtures.find(
    (item) => item.databaseId === question?.databaseContext?.databaseId,
  );
  assert(fixture, 'Capture must belong to the supplied database corpus');
  assert.equal(question.split, config.split, 'Capture split differs');
  const observed = (run.providerRequests ?? []).map((reference) => {
    const request = bySequence.get(reference.sequence);
    assert(
      request &&
        request.caseId === run.id &&
        request.model === config.model &&
        request.requestHash === reference.requestHash &&
        request.transmitted === reference.transmitted,
      'Provider capture reference does not match the original request',
    );
    return request;
  });
  return {
    ...run,
    evidence: projectDatabaseRowEvidence({
      caseId: run.id,
      evidence: run.evidence,
      toolCalls: run.toolCalls,
      providerRequests: observed,
      fixture,
    }),
  };
});
const output = projected.map((run) => JSON.stringify(run)).join('\n') + '\n';
const changedSources = projected.reduce(
  (total, run, index) =>
    total +
    run.evidence.filter(
      (source, sourceIndex) =>
        JSON.stringify(source) !==
        JSON.stringify(runs[index].evidence[sourceIndex]),
    ).length,
  0,
);
const provenance = {
  projectionVersion: 1,
  createdAt: new Date().toISOString(),
  inputs: inputs.map((file, index) => ({
    file: path.resolve(file),
    sha256: hash(bytes[index]),
  })),
  output: { file: path.resolve(outputPath), sha256: hash(output) },
  records: projected.length,
  changedSources,
  humanReview: 'unchanged',
  inference: 'not repeated',
};
await writeFile(outputPath, output, { flag: 'wx' });
await writeFile(
  outputPath + '.projection.json',
  JSON.stringify(provenance, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify({ records: projected.length, changedSources }));
