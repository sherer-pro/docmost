import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '../../..');
const root = path.join(repo, 'artifacts');

test('retrieval observation preserves results and separates overlapping request contexts', async () => {
  const output = await mkdtemp(path.join(root, 'retrieval-observer-'));
  assert(output.startsWith(root + path.sep));
  try {
    const cwd = path.join(output, 'runtime/apps/server');
    const moduleRoot = path.join(cwd, 'dist/apps/server/src/core/ai/retrieval');
    await mkdir(moduleRoot, { recursive: true });
    await mkdir(path.join(cwd, 'node_modules/reflect-metadata'), {
      recursive: true,
    });
    await writeFile(
      path.join(cwd, 'node_modules/reflect-metadata/index.js'),
      'module.exports = {};',
    );
    await writeFile(
      path.join(moduleRoot, 'ai-canonical-evidence.service.js'),
      "exports.AiCanonicalEvidenceService = class { async load(hit) { return {markdown: 'Canonical ' + hit.sourceId, version:'v1'}; } };",
    );
    await writeFile(
      path.join(moduleRoot, 'ai-retrieval.service.js'),
      `
const {AiCanonicalEvidenceService} = require('./ai-canonical-evidence.service');
exports.AiRetrievalService = class {
  async retrieveSafe(params) {
    const hits = this.fuseRanks([await this.localCandidates(params.request)]);
    const document = await new AiCanonicalEvidenceService().load(hits[0]);
    return {status:'used',sources:[{sourceId:hits[0].sourceId,excerpt:document.markdown}]};
  }
  async localCandidates(request) { await new Promise(resolve=>setTimeout(resolve,request.delay)); return [{sourceId:request.requestId,sourceType:'page',text:request.query}]; }
  fuseRanks(rankings) { return rankings.flat(); }
};`,
    );
    const main = path.join(cwd, 'main.cjs');
    await writeFile(
      main,
      `
const {AiRetrievalService} = require('./dist/apps/server/src/core/ai/retrieval/ai-retrieval.service');
Promise.all(['first','second'].map((requestId,index) => new AiRetrievalService().retrieveSafe({request:{requestId,query:'Query '+requestId,delay:index?1:20}}))).then(result=>process.stdout.write(JSON.stringify(result)));`,
    );
    const filename = path.join(cwd, 'capture.json');
    const trace = path.join(output, 'trace.jsonl');
    await writeFile(
      filename,
      JSON.stringify({ isolated: true, output: trace }),
    );
    const run = await exec(
      process.execPath,
      [
        '--require',
        path.join(repo, 'apps/server/test/ai-quality-retrieval-capture.cjs'),
        main,
        `--quality-capture-config=${filename}`,
      ],
      { cwd, windowsHide: true },
    );
    assert.deepEqual(
      JSON.parse(run.stdout),
      ['first', 'second'].map((sourceId) => ({
        status: 'used',
        sources: [{ sourceId, excerpt: `Canonical ${sourceId}` }],
      })),
    );
    const observations = (await readFile(trace, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(observations.length, 8);
    for (const requestId of ['first', 'second']) {
      const records = observations.filter(
        (item) => item.requestId === requestId,
      );
      assert.deepEqual(
        records.map((item) => item.phase),
        [
          'local_candidates',
          'ranked_candidates',
          'canonical_document',
          'outcome',
        ],
      );
      assert.equal(records[0].data[0].sourceId, requestId);
      assert.equal(records[2].data.document.markdown, `Canonical ${requestId}`);
    }
    await writeFile(
      filename,
      JSON.stringify({ isolated: false, output: trace }),
    );
    await assert.rejects(
      exec(
        process.execPath,
        [
          '--require',
          path.join(repo, 'apps/server/test/ai-quality-retrieval-capture.cjs'),
          main,
          `--quality-capture-config=${filename}`,
        ],
        { cwd, windowsHide: true },
      ),
      /Quality capture requires/,
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
