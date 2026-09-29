import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ratio = (numerator, denominator) =>
  denominator ? numerator / denominator : null;
const percentile = (values, p) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
    : null;

export function evaluate(
  corpus,
  runs,
  { split = "holdout", profile = "evidence-v1" } = {},
) {
  const cases = corpus.questions.filter((item) => item.split === split);
  if (!cases.length) throw new Error(`Empty or unknown split: ${split}`);
  const byId = new Map(runs.map((run) => [run.id, run]));
  if (byId.size !== runs.length) throw new Error("Duplicate run IDs");
  let required = 0,
    found = 0,
    answerable = 0,
    refused = 0,
    supported = 0,
    claims = 0;
  let citationCount = 0,
    validCitations = 0,
    forbiddenEvidence = 0,
    forbiddenAnswers = 0;
  let reviewed = 0,
    completed = 0;
  const failures = [],
    latencies = [],
    inputTokens = [],
    outputTokens = [];
  for (const item of cases) {
    const run = byId.get(item.id);
    if (!run) {
      failures.push({ id: item.id, reason: "missing_run" });
      continue;
    }
    completed++;
    if (
      (item.forbiddenClaims ?? []).some((text) =>
        String(run.answer ?? "").includes(text),
      )
    ) {
      forbiddenAnswers++;
      failures.push({ id: item.id, reason: "forbidden_answer" });
    }
    if (run.profile !== profile)
      throw new Error(`Profile mismatch: ${item.id}`);
    const candidates = (run.candidates ?? []).slice(0, 40);
    const evidence = run.evidence ?? [];
    for (const expected of item.requiredEvidence) {
      required++;
      if (
        candidates.some(
          (source) =>
            source.sourceId === expected.sourceId &&
            expected.contains.every((text) => source.text.includes(text)),
        )
      )
        found++;
      else
        failures.push({
          id: item.id,
          reason: "retrieval_miss",
          sourceId: expected.sourceId,
        });
    }
    if (
      item.answerability === "answerable" ||
      item.answerability === "conflict"
    ) {
      answerable++;
      if (run.refused === true) refused++;
    }
    for (const source of evidence) {
      if (
        !item.allowedSourceIds.includes(source.sourceId) ||
        source.readable !== true ||
        source.current !== true ||
        source.transmitted !== true
      )
        forbiddenEvidence++;
    }
    for (const marker of run.citations ?? []) {
      citationCount++;
      if (
        evidence.some(
          (source) =>
            source.marker === marker &&
            source.readable === true &&
            source.current === true &&
            source.transmitted === true &&
            item.allowedSourceIds.includes(source.sourceId),
        )
      )
        validCitations++;
    }
    // Support is a human annotation, never an automatic substring proxy.
    if (run.review?.human === true && Array.isArray(run.review.claims)) {
      reviewed++;
      for (const claim of run.review.claims) {
        if (typeof claim.supported !== "boolean") continue;
        claims++;
        if (claim.supported) supported++;
      }
    }
    if (Number.isFinite(run.preparationMs) && run.preparationMs >= 0)
      latencies.push(run.preparationMs);
    if (Number.isFinite(run.inputTokens)) inputTokens.push(run.inputTokens);
    if (Number.isFinite(run.outputTokens)) outputTokens.push(run.outputTokens);
  }
  const metrics = {
    evidenceRecallAt40: ratio(found, required),
    factualSupport: ratio(supported, claims),
    citationValidity: ratio(validCitations, citationCount),
    falseAbstention: ratio(refused, answerable),
    forbiddenEvidence,
    forbiddenAnswers,
    preparationP95Ms: percentile(latencies, 0.95),
    inputTokens: inputTokens.reduce((a, b) => a + b, 0),
    outputTokens: outputTokens.reduce((a, b) => a + b, 0),
  };
  const measured =
    completed === cases.length &&
    reviewed === cases.length &&
    claims > 0 &&
    latencies.length === cases.length;
  return {
    schemaVersion: 1,
    corpusVersion: corpus.version,
    split,
    profile,
    completed,
    expected: cases.length,
    humanReviewed: reviewed,
    measured,
    accepted:
      measured &&
      metrics.evidenceRecallAt40 >= 0.9 &&
      metrics.factualSupport >= 0.95 &&
      metrics.falseAbstention <= 0.1 &&
      forbiddenEvidence === 0 &&
      forbiddenAnswers === 0 &&
      validCitations === citationCount &&
      metrics.preparationP95Ms <= 10_000,
    metrics,
    failures,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, output, split = "holdout", profile = "evidence-v1"] =
    process.argv.slice(2);
  if (!input || !output)
    throw new Error(
      "Usage: node scripts/rag-quality-benchmark.mjs results.jsonl report.json [tuning|holdout] [profile]",
    );
  const corpus = JSON.parse(
    await readFile(
      new URL("../tests/rag-quality/corpus.json", import.meta.url),
      "utf8",
    ),
  );
  const runs = (await readFile(input, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const report = evaluate(corpus, runs, { split, profile });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      completed: report.completed,
      expected: report.expected,
      measured: report.measured,
      accepted: report.accepted,
    }),
  );
  if (!report.accepted) process.exitCode = 1;
}
