import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluate } from "./rag-quality-benchmark.mjs";
import { evaluateDatabaseTrace } from "./ai-database-quality.mjs";

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
  assert.equal(corpus.databaseQuestions.length, 160);
  assert.equal(
    corpus.databaseQuestions.filter((q) => q.split === "holdout").length,
    64,
  );
  for (const fixture of corpus.databaseFixtures) {
    assert.equal(fixture.records.filter((row) => row.budget === null).length, 1);
    assert.equal(fixture.records.filter((row) => row.date === null).length, 1);
    assert.ok(fixture.records.some((row) => row.notes?.includes("OVERRIDE-ACCEPTED")));
    const cases = corpus.databaseQuestions.filter((q) => q.databaseContext.databaseId === fixture.databaseId);
    for (const name of ["empty_budget", "empty_date"]) {
      const question = cases.find((q) => q.category === `database_${name}`);
      assert.equal(question.databaseExpectation.result.count, 1);
      assert.equal(question.databaseContext.viewState.filter.conditions[0].operator, "is_empty");
    }
  }
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

test("database scoring rejects a correct total with an extra write or a changed proposal target", () => {
  const expected = {
    databaseId: "database",
    tool: "summarizeDatabaseView",
    result: { count: 291 },
  };
  const read = {
    name: expected.tool,
    arguments: { databaseId: "database" },
    result: { count: 291 },
  };
  assert.equal(evaluateDatabaseTrace(expected, [read]), true);
  assert.equal(
    evaluateDatabaseTrace(expected, [read, { name: "proposeDatabaseCells" }]),
    false,
  );
  assert.equal(
    evaluateDatabaseTrace(expected, [{ ...read, result: { count: 20 } }]),
    false,
  );
  const rows = [
    {
      pageId: "row",
      cells: [{ propertyId: "status", value: "done", expectedRevision: 1 }],
    },
  ];
  const write = {
    name: "proposeDatabaseCells",
    arguments: { databaseId: "database", rows },
  };
  assert.equal(
    evaluateDatabaseTrace({ databaseId: "database", tool: write.name, rows }, [
      write,
    ]),
    true,
  );
  assert.equal(
    evaluateDatabaseTrace({ databaseId: "database", tool: write.name, rows }, [
      {
        ...write,
        arguments: {
          ...write.arguments,
          rows: [...rows, { ...rows[0], pageId: "other" }],
        },
      },
    ]),
    false,
  );
});
