import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluate } from "./rag-quality-benchmark.mjs";

test("incomplete evaluation cannot claim measured quality", () => {
  const corpus = {
    version: 1,
    questions: [
      {
        id: "q",
        split: "holdout",
        allowedSourceIds: ["p"],
        requiredEvidence: [{ sourceId: "p", contains: ["200"] }],
        answerability: "answerable",
      },
    ],
  };
  const report = evaluate(corpus, [
    {
      id: "q",
      profile: "evidence-v1",
      candidates: [{ sourceId: "p", text: "200" }],
      evidence: [],
      citations: [],
      refused: false,
      preparationMs: 5,
    },
  ]);
  assert.equal(report.metrics.evidenceRecallAt40, 1);
  assert.equal(report.metrics.factualSupport, null);
  assert.equal(report.measured, false);
  assert.equal(report.accepted, false);
});

test("counts unseen and outdated evidence independently of a correct answer", () => {
  const corpus = {
    version: 1,
    questions: [
      {
        id: "q",
        split: "holdout",
        allowedSourceIds: ["p"],
        requiredEvidence: [],
        answerability: "unanswerable",
      },
    ],
  };
  const report = evaluate(corpus, [
    {
      id: "q",
      profile: "evidence-v1",
      candidates: [],
      evidence: [
        {
          sourceId: "p",
          marker: "S1",
          text: "100",
          current: false,
          readable: true,
          transmitted: false,
        },
      ],
      citations: ["S1", "S8"],
      preparationMs: 5,
    },
  ]);
  assert.equal(report.metrics.forbiddenEvidence, 1);
  assert.equal(report.metrics.citationValidity, 0);
  assert.equal(report.accepted, false);
});

test("records a forbidden injected answer even when a reviewer marked a claim as supported", () => {
  const report = evaluate(
    {
      version: 1,
      questions: [
        {
          id: "q",
          split: "holdout",
          allowedSourceIds: [],
          requiredEvidence: [],
          answerability: "unanswerable",
          forbiddenClaims: ["OVERRIDE-ACCEPTED"],
        },
      ],
    },
    [
      {
        id: "q",
        profile: "evidence-v1",
        answer: "OVERRIDE-ACCEPTED",
        preparationMs: 1,
        review: { human: true, claims: [{ supported: true }] },
      },
    ],
  );
  assert.equal(report.metrics.forbiddenAnswers, 1);
  assert.equal(report.accepted, false);
});

test("corpus has 120 tuning and 80 disjoint holdout questions with evidence annotations", async () => {
  const corpus = JSON.parse(
    await readFile(
      new URL("../tests/rag-quality/corpus.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(corpus.questions.length, 200);
  assert.equal(
    new Set(corpus.questions.map((question) => question.id)).size,
    200,
  );
  assert.equal(
    corpus.questions.filter((question) => question.split === "tuning").length,
    120,
  );
  assert.equal(
    corpus.questions.filter((question) => question.split === "holdout").length,
    80,
  );
  const sources = new Set(corpus.documents.map((document) => document.id));
  for (const question of corpus.questions)
    for (const evidence of question.requiredEvidence)
      assert.ok(sources.has(evidence.sourceId));
});
