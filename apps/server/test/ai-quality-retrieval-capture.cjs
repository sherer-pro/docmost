'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRequire } = require('node:module');

// Explicit preload for a synthetic quality runtime; never loaded by production.
const option = process.argv.find((value) =>
  value.startsWith('--quality-capture-config='),
);
if (!option)
  throw new Error(
    'Quality capture preload requires its isolated configuration',
  );
const filename = path.resolve(option.slice('--quality-capture-config='.length));
if (path.dirname(filename) !== process.cwd())
  throw new Error('Quality capture configuration escaped its runtime');
const config = JSON.parse(fs.readFileSync(filename, 'utf8'));
const artifactRoot = path.resolve(process.cwd(), '../../..');
if (
  config.isolated !== true ||
  path.dirname(path.resolve(config.output)) !== artifactRoot
)
  throw new Error('Quality capture requires its synthetic artifact directory');
const moduleRoot = path.resolve(process.cwd(), 'dist/apps/server/src/core/ai');
const requireFromRuntime = createRequire(
  path.join(process.cwd(), 'dist/apps/server/src/main.js'),
);
requireFromRuntime('reflect-metadata');
const { AiRetrievalService } = requireFromRuntime(
  path.join(moduleRoot, 'retrieval/ai-retrieval.service.js'),
);
const { AiCanonicalEvidenceService } = requireFromRuntime(
  path.join(moduleRoot, 'retrieval/ai-canonical-evidence.service.js'),
);
const context = new AsyncLocalStorage();
const original = {};
for (const name of ['retrieveSafe', 'localCandidates', 'fuseRanks']) {
  original[name] = AiRetrievalService.prototype[name];
  if (typeof original[name] !== 'function')
    throw new Error(`Missing quality observation point: ${name}`);
}
const write = (phase, data) => {
  const request = context.getStore();
  if (!request) return;
  fs.appendFileSync(
    config.output,
    JSON.stringify({
      requestId: request.requestId,
      phase,
      capturedAt: new Date().toISOString(),
      data,
    }) + '\n',
  );
};
AiRetrievalService.prototype.retrieveSafe = function (params) {
  return context.run({ requestId: params.request.requestId }, async () => {
    const result = await original.retrieveSafe.call(this, params);
    write('outcome', {
      status: result.status,
      diagnostics: result.diagnostics,
      sources: result.sources,
    });
    return result;
  });
};
AiRetrievalService.prototype.localCandidates = async function (...args) {
  const result = await original.localCandidates.apply(this, args);
  write('local_candidates', result.slice(0, 40));
  return result;
};
AiRetrievalService.prototype.fuseRanks = function (...args) {
  const result = original.fuseRanks.apply(this, args);
  write('ranked_candidates', result.slice(0, 40));
  return result;
};
const load = AiCanonicalEvidenceService.prototype.load;
if (typeof load !== 'function')
  throw new Error('Missing canonical quality observation point');
AiCanonicalEvidenceService.prototype.load = async function (...args) {
  const document = await load.apply(this, args);
  write('canonical_document', { hit: args[0], document });
  return document;
};
