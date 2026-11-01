import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  providerTextSegments,
  sourceWasTransmitted,
} from './ai-quality-transmission.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sameIds = (left, right) =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  new Set(right).size === right.length &&
  left.every((id) => right.includes(id));
function decode(bytes, role) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`Invalid UTF-8 in ${role}`);
  }
}
function parseJson(text, role) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in ${role}`);
  }
}
function parseLines(bytes, role) {
  requireValue(bytes.at(-1) === 10, `${role} must end in LF`);
  const lines = decode(bytes, role).split(/\r?\n/);
  lines.pop();
  requireValue(lines.every(Boolean), `Blank record in ${role}`);
  return lines.map((line) => parseJson(line, role));
}

export function projectRagTransmission({
  corpusBytes,
  runsBytes,
  providerBytes,
  configBytes,
}) {
  const corpus = parseJson(decode(corpusBytes, 'corpus'), 'corpus');
  const runs = parseLines(runsBytes, 'run capture');
  const requests = parseLines(providerBytes, 'provider capture');
  const config = parseJson(
    decode(configBytes, 'configuration'),
    'configuration',
  );
  requireValue(config.scope === 'rag', 'Only RAG captures can be projected');
  requireValue(
    ['tuning', 'holdout'].includes(config.split),
    'Invalid captured split',
  );
  requireValue(
    typeof config.model === 'string' && config.model.length > 0,
    'Missing captured model',
  );
  requireValue(
    config.corpusSha256 === hash(corpusBytes),
    'Captured corpus bytes changed',
  );
  requireValue(Array.isArray(corpus.questions), 'Missing RAG corpus questions');
  const questions = corpus.questions.filter(
    (question) => question.split === config.split,
  );
  const byId = new Map(questions.map((question) => [question.id, question]));
  requireValue(
    byId.size === questions.length && questions.length > 0,
    'Duplicate or missing corpus cases',
  );
  requireValue(
    Array.isArray(config.questionIds),
    'Missing configured question IDs',
  );
  requireValue(
    config.limit === 0,
    'Replay requires a complete captured RAG scope',
  );
  requireValue(
    sameIds(config.questionIds, [...byId.keys()]),
    'Configured cases differ from the complete corpus split',
  );
  requireValue(
    sameIds(
      runs.map((run) => run.id),
      config.questionIds,
    ),
    'Duplicate, missing or cross-split captured cases',
  );
  const bySequence = new Map();
  for (const request of requests) {
    requireValue(
      Number.isSafeInteger(request.sequence) &&
        request.sequence > 0 &&
        !bySequence.has(request.sequence),
      'Invalid or duplicate provider sequence',
    );
    requireValue(
      typeof request.requestHash === 'string' &&
        /^[a-f0-9]{64}$/.test(request.requestHash),
      'Invalid provider request hash',
    );
    requireValue(
      request.model === config.model,
      'Provider model differs from the captured configuration',
    );
    requireValue(
      typeof request.caseId === 'string' && request.caseId.length > 0,
      'Missing provider case ID',
    );
    requireValue(
      typeof request.transmitted === 'boolean',
      'Invalid provider delivery flag',
    );
    requireValue(
      Object.hasOwn(request, 'status') &&
        (request.status === null ||
          (Number.isInteger(request.status) &&
            request.status >= 100 &&
            request.status <= 599)),
      'Missing or invalid provider status',
    );
    requireValue(
      request.transportError === undefined ||
        typeof request.transportError === 'boolean',
      'Invalid provider transport flag',
    );
    requireValue(
      Array.isArray(request.messages),
      'Missing captured provider messages',
    );
    bySequence.set(request.sequence, request);
  }
  let changedSources = 0;
  const changedCases = [];
  const changes = [];
  const projected = runs.map((run) => {
    requireValue(
      byId.has(run.id) && typeof run.runId === 'string' && run.runId.length > 0,
      'Capture does not belong to the supplied corpus',
    );
    requireValue(
      run.profile === 'evidence-v1',
      'Captured quality profile differs',
    );
    requireValue(
      Array.isArray(run.providerRequests) && Array.isArray(run.evidence),
      'Missing capture references or evidence',
    );
    requireValue(
      run.evidence.length === 0 || run.providerRequests.length > 0,
      'Evidence has no provider references',
    );
    const referenced = new Set();
    const observed = run.providerRequests.map((reference) => {
      const request = bySequence.get(reference.sequence);
      requireValue(
        !referenced.has(reference.sequence),
        'Duplicate provider reference',
      );
      referenced.add(reference.sequence);
      requireValue(
        request &&
          request.caseId === run.id &&
          request.model === config.model &&
          request.requestHash === reference.requestHash &&
          request.transmitted === reference.transmitted &&
          request.status === reference.status,
        'Provider capture reference does not match case, model, hash, status or delivery',
      );
      return request;
    });
    const segments = providerTextSegments(observed);
    const markers = new Set();
    let changed = false;
    const evidence = run.evidence.map((source) => {
      requireValue(
        typeof source.marker === 'string' &&
          /^S[1-9]\d*$/.test(source.marker) &&
          !markers.has(source.marker),
        'Invalid or duplicate evidence marker',
      );
      markers.add(source.marker);
      requireValue(
        typeof source.sourceId === 'string' &&
          typeof source.text === 'string' &&
          typeof source.transmitted === 'boolean',
        'Malformed captured evidence',
      );
      const transmitted = sourceWasTransmitted(
        segments,
        source.marker,
        source.text,
      );
      if (source.transmitted !== transmitted) {
        changedSources++;
        changed = true;
        changes.push({
          id: run.id,
          sourceId: source.sourceId,
          marker: source.marker,
          before: source.transmitted,
          after: transmitted,
          providerSequences: observed.map((request) => request.sequence),
        });
      }
      // Preserve every field except the independently observed transmission bit.
      return { ...source, transmitted };
    });
    if (changed) changedCases.push(run.id);
    return { ...run, evidence };
  });
  return { projected, changedSources, changedCases, changes };
}

async function absent(file) {
  try {
    await access(file);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Projection output already exists');
}

export async function reprojectRagFiles({
  corpusPath,
  runsPath,
  providerPath,
  outputPath,
}) {
  const configPath = path.join(
    path.dirname(runsPath),
    'quality-configuration.json',
  );
  const inputPaths = [corpusPath, runsPath, providerPath, configPath].map(
    (file) => path.resolve(file),
  );
  const output = path.resolve(outputPath);
  const provenancePath = output + '.projection.json';
  requireValue(
    [output, provenancePath].every((file) => !inputPaths.includes(file)),
    'Projection output must differ from every input',
  );
  await absent(output);
  await absent(provenancePath);
  const bytes = await Promise.all(inputPaths.map((file) => readFile(file)));
  const result = projectRagTransmission({
    corpusBytes: bytes[0],
    runsBytes: bytes[1],
    providerBytes: bytes[2],
    configBytes: bytes[3],
  });
  const outputBytes = Buffer.from(
    result.projected.map((run) => JSON.stringify(run)).join('\n') + '\n',
  );
  const provenance = {
    projectionVersion: 1,
    scope: 'rag',
    createdAt: new Date().toISOString(),
    inputs: inputPaths.map((file, index) => ({
      file,
      sha256: hash(bytes[index]),
    })),
    output: { file: output, sha256: hash(outputBytes) },
    records: result.projected.length,
    changedSources: result.changedSources,
    changedCases: result.changedCases,
    changes: result.changes,
    changedFields: ['evidence[].transmitted'],
    humanReview: 'unchanged',
    answersAndCitations: 'unchanged',
    inference: 'not repeated',
    observer: {
      file: fileURLToPath(
        new URL('./ai-quality-transmission.mjs', import.meta.url),
      ),
      sha256: hash(
        await readFile(
          new URL('./ai-quality-transmission.mjs', import.meta.url),
        ),
      ),
    },
  };
  for (let index = 0; index < inputPaths.length; index++)
    requireValue(
      hash(await readFile(inputPaths[index])) === hash(bytes[index]),
      'Projection inputs changed while reading',
    );
  await writeFile(output, outputBytes, { flag: 'wx' });
  await writeFile(provenancePath, JSON.stringify(provenance, null, 2) + '\n', {
    flag: 'wx',
  });
  requireValue(
    hash(await readFile(output)) === provenance.output.sha256,
    'Saved projection checksum differs',
  );
  return {
    records: result.projected.length,
    changedSources: result.changedSources,
    changedCases: result.changedCases,
    output,
    provenancePath,
    sha256: provenance.output.sha256,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [corpusPath, runsPath, providerPath, outputPath, ...extra] =
    process.argv.slice(2);
  try {
    requireValue(
      corpusPath &&
        runsPath &&
        providerPath &&
        outputPath &&
        extra.length === 0,
      'Usage: node reproject-ai-rag-transmission.mjs CORPUS.json RUNS.jsonl PROVIDER.jsonl OUTPUT.jsonl',
    );
    console.log(
      JSON.stringify(
        await reprojectRagFiles({
          corpusPath,
          runsPath,
          providerPath,
          outputPath,
        }),
      ),
    );
  } catch (error) {
    console.error('RAG transmission projection refused: ' + error.message);
    process.exitCode = 1;
  }
}
