# RAG evidence quality evaluation

`corpus.json` contains 80 synthetic documents, 120 tuning questions and 80 holdout
questions about disjoint products. It is not a production sample; human validation
is pending. Do not use holdout answers to tune prompts, embeddings or ranking.

Regenerate with `node scripts/generate-rag-quality-corpus.mjs`; validate with
`node --test scripts/rag-quality-benchmark.test.mjs`. Import into an isolated space
and map fixture IDs to real source IDs. Apply each question's access and stale
index setup, then restore it between questions. Policy mutations cover ACL
revocation, deletion, moving to another space, non-DONE status and exclusion.
Never weaken live ACLs. The private source remains unavailable in every variant.

Capture one runtime record per question as JSONL:

```json
{"id":"q001","profile":"evidence-v1","candidates":[{"sourceId":"fixture-uuid","text":"canonical candidate"}],"evidence":[{"sourceId":"fixture-uuid","marker":"S1","text":"transmitted evidence","version":"2026-09-29T09:00:00Z","readable":true,"current":true,"transmitted":true}],"citations":["S1"],"answer":"answer text","refused":false,"preparationMs":250,"inputTokens":300,"outputTokens":40,"review":{"human":true,"claims":[{"text":"claim","supported":true}]}}
```

Candidates and evidence must come from instrumentation, never a model's
self-report. Keep sensitive captures outside Git under the originating private
conversation's access and retention policy. Review claims, units, conditions,
conflicts, false premises, refusal usefulness and document prompt injection.
An automatic judge may suggest annotations. Only a human can set `review.human`;
review all disagreements and a random control sample. Retain reviewer identity
in the protected experiment log, not this repository.

Run `node scripts/rag-quality-benchmark.mjs results.jsonl report.json holdout evidence-v1`.
Missing runs, review or timing cannot pass. Acceptance targets: recall@40 >=90%,
supported factual claims >=95%, false abstention <=10%, no inaccessible, stale or
untransmitted evidence, and preparation p95 <=10000 ms. Lexical evidence matching
is a retrieval diagnostic, not a faithfulness judge.

Fix the generation model, embeddings, corpus revision, hardware and concurrency.
Record cold and warm latency separately. Compare one change at a time: context,
projection, hybrid, reranker, extra queries. Test `BAAI/bge-reranker-v2-m3` through
Open WebUI's existing reranker setting on the target hardware. Keep it disabled
until human-reviewed quality improves within the latency budget.

The existing retrieval-test endpoint accepts optional `canary: {query, sourceId,
expectedText}`. Use a non-sensitive known fact in a readable DONE page. A healthy
connection with `canary: failed` means query-time evidence resolution needs
investigation even when synchronization is healthy. Canaries do not write data
or create recurring jobs.

Baseline status: **unmeasured**. Fixture validation and unit tests do not establish
production relevance, Russian-language answer quality or reranker benefit.

The schema acceptance test uses a dedicated local PostgreSQL database ending in
`_test`, with no application environment file. Set `RAG_QUALITY_TEST_DATABASE_URL`
and run `corepack pnpm --filter ./apps/server exec jest --config test/jest-e2e.json
--runInBand test/rag-evidence-quality.e2e-spec.ts`. The test owns a unique schema
and verifies defaults, constraints, evidence JSON and migration rollback.
