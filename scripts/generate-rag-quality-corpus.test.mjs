import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRagQualityCorpus } from "./generate-rag-quality-corpus.mjs";

const originalSha256 = "7b062ec4cfedaccd1980213f4549393117dd6fb9d11bf885c15db5b077f285d4";
const canonicalSha256 = "e840508bc389b45345cc8631058d9295c58fc67f445347e0d1e7d3a0f74c596d";
const approvedQuestionsSha256 = "888a91c3734b39b511241a5c6c34d5ac1b16fb65092bf00341bb485d7d93a2bb";
const generator = fileURLToPath(new URL("./generate-rag-quality-corpus.mjs", import.meta.url));
const frozen = new URL("../tests/rag-quality/corpus-v5.json", import.meta.url);
const latest = new URL("../tests/rag-quality/corpus.json", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const serialize = (value) => JSON.stringify(value, null, 2) + "\n";
const execute = promisify(execFile);

async function isolatedGenerator(t) {
  const directory = await mkdtemp(join(tmpdir(), "docmost-rag-corpus-"));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert(basename(directory).startsWith("docmost-rag-corpus-"));
    await rm(directory, { recursive: true, force: true });
  });
  const script = join(directory, "scripts", "generate-rag-quality-corpus.mjs");
  await mkdir(dirname(script), { recursive: true });
  await copyFile(generator, script);
  return { directory, script };
}

function cli(script, args) {
  return execute(process.execPath, [script, ...args], {
    cwd: dirname(script),
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 256 * 1024,
  });
}

async function refused(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, 1);
    return true;
  });
}

test("preserves exact original v5 bytes and reproducible canonical content", async () => {
  const bytes = await readFile(frozen);
  assert.equal(bytes.length, 5990221);
  assert.equal(hash(bytes), originalSha256);
  assert.equal(hash(bytes.toString("utf8").replaceAll("\r\n", "\n")), canonicalSha256);
  const generated = createRagQualityCorpus(5);
  assert.deepEqual(generated, JSON.parse(bytes));
  assert.equal(hash(serialize(generated)), canonicalSha256);
  assert.equal(hash(serialize(generated).replaceAll("\n", "\r\n")), originalSha256);
  const provenance = JSON.parse(await readFile(new URL("../tests/rag-quality/corpus-v5.provenance.json", import.meta.url), "utf8"));
  assert.equal(provenance.originalBytesSha256, originalSha256);
  assert.equal(provenance.canonicalLfSha256, canonicalSha256);
  const attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
  assert.match(attributes, /^tests\/rag-quality\/corpus-v5\.json -text whitespace=cr-at-eol$/m);
});

test("v6 changes only the approved twenty access questions and version", async () => {
  const v5 = createRagQualityCorpus(5);
  const v6 = createRagQualityCorpus(6);
  const restored = structuredClone(v6);
  assert.equal(v5.version, 5);
  assert.equal(v6.version, 6);
  restored.version = 5;
  const changed = [];
  for (let i = 0; i < v5.databaseQuestions.length; i++) {
    const before = v5.databaseQuestions[i];
    const after = v6.databaseQuestions[i];
    assert.equal(after.id, before.id);
    if (before.question === after.question) continue;
    assert.equal(after.category, "database_access");
    changed.push({ id: after.id, split: after.split, question: after.question });
    restored.databaseQuestions[i].question = before.question;
  }
  assert.deepEqual(changed.map((item) => item.id), Array.from({ length: 20 }, (_, i) => `db-${i + 1}-access`));
  assert.equal(changed.filter((item) => item.split === "tuning").length, 12);
  assert.equal(changed.filter((item) => item.split === "holdout").length, 8);
  assert.equal(hash(JSON.stringify(changed)), approvedQuestionsSha256);
  assert.deepEqual(restored, v5);
  assert.deepEqual(JSON.parse(await readFile(latest, "utf8")), v6);
  assert.deepEqual(createRagQualityCorpus(), v6);
});

test("factory calls return independent deterministic data and reject unsupported versions", () => {
  const first = createRagQualityCorpus(5);
  first.documents[0].markdown = "changed";
  first.databaseFixtures[0].records[0].budget = -1;
  first.databaseQuestions[0].question = "changed";
  assert.equal(hash(serialize(createRagQualityCorpus(5))), canonicalSha256);
  assert.deepEqual(createRagQualityCorpus(6), createRagQualityCorpus(6));
  for (const version of [0, 4, 7, "5", "6", null])
    assert.throws(() => createRagQualityCorpus(version), RangeError);
});

test("importing the generator does not create corpus files", async (t) => {
  const { directory, script } = await isolatedGenerator(t);
  const result = await execute(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(script).href)})`], {
    cwd: directory,
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(result.stdout, "");
  await assert.rejects(access(join(directory, "tests")), { code: "ENOENT" });
});

test("CLI reproduces both versions only in new candidate files", async (t) => {
  const { directory, script } = await isolatedGenerator(t);
  for (const version of [5, 6]) {
    const output = join(directory, `candidate-v${version}.json`);
    const result = await cli(script, [`--version=${version}`, "--output", output]);
    const bytes = await readFile(output);
    assert.deepEqual(JSON.parse(bytes), createRagQualityCorpus(version));
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.version, version);
    assert.equal(receipt.sha256, hash(bytes));
    assert.equal(receipt.holdout, 160);
  }
  const output = join(directory, "candidate-default.json");
  await cli(script, ["--output", output]);
  assert.equal(JSON.parse(await readFile(output, "utf8")).version, 6);
});

test("CLI never replaces existing outputs or creates the frozen v5 archive", async (t) => {
  const { directory, script } = await isolatedGenerator(t);
  const root = join(directory, "tests", "rag-quality");
  await mkdir(root, { recursive: true });
  const archive = join(root, "corpus-v5.json");
  const current = join(root, "corpus.json");
  const custom = join(directory, "existing.json");
  for (const file of [archive, current, custom]) await writeFile(file, "preserve original\r\n", { flag: "wx" });
  for (const version of [5, 6]) {
    await refused(cli(script, ["--version", String(version), "--output", archive]));
    assert.equal(await readFile(archive, "utf8"), "preserve original\r\n");
    await refused(cli(script, ["--version", String(version), "--output", custom]));
    assert.equal(await readFile(custom, "utf8"), "preserve original\r\n");
  }
  await refused(cli(script, []));
  assert.equal(await readFile(current, "utf8"), "preserve original\r\n");
  await unlink(archive);
  await refused(cli(script, ["--version", "5", "--output", archive]));
  await assert.rejects(access(archive), { code: "ENOENT" });
});

test("CLI rejects ambiguous options and never defaults v5 into the current corpus", async (t) => {
  const { directory, script } = await isolatedGenerator(t);
  for (const args of [
    ["--version", "5"],
    ["--version", "4"],
    ["--version", "5.0"],
    ["--output"],
    ["--output", ""],
    ["--unknown", "value"],
    ["--version", "6", "--version", "5"],
    ["--force"],
  ]) await refused(cli(script, args));
  await assert.rejects(access(join(directory, "tests")), { code: "ENOENT" });
});
