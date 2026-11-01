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

The version 5 corpus also includes 200 structured database cases (120 tuning / 80 holdout),
in addition to the original 200 RAG questions. Provision the synthetic
`databaseFixtures` with their supplied property/row IDs; the database root page
uses the fixture database ID. Apply each case's selection and filters. Record
actual server `toolCalls` with `name`, `arguments`, and `result` alongside the
ordinary reviewed answer, evidence and timing. Database totals and proposed
cell/revision lists are scored against the oracle; an extra write fails a read
case. Empty budgets and dates are actual null cells; selected and ordinary rows
contain synthetic prompt injection that must not change the requested proposal.
Dictionary forms are qualified by product so all terms can be imported into one
space under its actual unique-alias constraint. This fixture correction does not
separate products into artificially small search spaces. The combined holdout
contains 160 cases. Fixtures and successful evaluator
tests do not count as measured model quality.

Baseline status: **unmeasured**. Fixture validation and unit tests do not establish
production relevance, Russian-language answer quality or reranker benefit.

For real database tool traces, build the application and run:

```powershell
node apps/client/e2e/database/run-live.mjs --ai-quality --quality-split=tuning --quality-provider=http://127.0.0.1:1234/v1 --quality-model=google/gemma-4-12b-qat
```

The default provider is the operator-selected LM Studio endpoint above. The
runner accepts only unauthenticated HTTP loopback origins, creates synthetic
actors and databases, enforces row ACLs and inherited AI exclusions, and records
actual `ai_run_steps` plus safe run snapshots. Proposals remain unapproved.
Read cases also enumerate the initiating user's private result link and compare
the complete observed row-ID set with the oracle. A coincidental correct number,
partial enumeration or duplicate row fails. `database_nl_done` and
`database_nl_dates` start from the open-status view and require a different
selection requested in natural language; their target filters are not supplied
as the current view. The read audit follows inference and has a separate
`selectionAuditMs`, so its HTTP work does not inflate model latency.

An authenticated test-only loopback observer forwards inference bytes to the
fixed operator-selected model and records the actual messages, tool schemas,
parameters and request hashes in `quality-provider-requests.jsonl`. Per-case
records reference its sequence/hash entries. Provider authorization and arbitrary
client headers are never recorded or forwarded. The observer rejects other
origins, model names, model-management paths and credential fields in request
bodies, and closes with its isolated runtime. It exposes no model-management
endpoint and forwards inference only to the fixed selected model.
Transport capture alone does not provide retrieval-candidate instrumentation,
human claim review or combined RAG quality acceptance.
`--quality-limit=6` is a connectivity/tuning diagnostic, not corpus acceptance.
After a complete tuning capture, `--quality-ids=id1,id2` can isolate observed
tuning failures without opening holdout. IDs must belong to the selected scope
and tuning split; duplicate, unknown and holdout IDs are rejected. This option
cannot be combined with `--quality-limit`. Configuration receipts retain the
explicit IDs and the actual question list. A targeted diagnostic does not replace
the complete corpus capture or the full holdout gate. Selection helpers are
checked by `node --test apps/server/test/ai-quality-selection.test.mjs`.
Fix settings before the separate `--quality-split=holdout` run. Configuration,
corpus hash, run IDs, tool traces and timings stay in the isolated run's ignored
artifact directory. Missing preparation timing stays null. The runner always
marks human review pending; trace correctness alone cannot establish answer
faithfulness or satisfy the combined RAG quality gate.

Use `--quality-scope=rag` for the document questions. It imports all 80 documents
through the application's page, row, dictionary and Markdown-attachment APIs in
one isolated space. Current-document context is disabled, so the expected guide
is not supplied as the answer's starting context. Dialogue history uses real
messages. The ordinary external fixture returns no hits: ranking comes from the
application's real local search. Only adversarial cases inject the explicitly
stale hit. A separate readable probe tests each policy mutation while the
original private source remains closed throughout.

The importer waits for readable Markdown attachment contents to become searchable
through `/search/attachments`, retaining opaque fixture filenames. It records
those readiness results separately. Earlier captures without plain-text content
indexing remain an immutable baseline; they are not relabeled as fixed results.

An explicit test-only Node preload records actual ranked candidates, canonical
documents loaded by retrieval and its outcome in `quality-retrieval-trace.jsonl`.
It preserves the original return values and separates concurrent request IDs;
`node --test apps/server/test/ai-quality-retrieval-capture.test.mjs` checks that
boundary. Candidate text is never filled from the oracle: an unhydrated local
candidate without an observed canonical document retains empty text. These
captures are local-search/pipeline measurements, not a measurement of a remote
vector index. Provider captures establish actual transmission independently.
`ai-quality-transmission.mjs` decodes actual JSON reference frames and multimodal
text arrays before checking source markers and multiline excerpts. It neither
combines unrelated string leaves nor fills evidence from model self-report.
History setup requests have their own capture IDs, so they cannot prove that
evidence was transmitted for the final question. Its standalone tests run with
`node --test apps/server/test/ai-quality-transmission.test.mjs`.

The decoder recognizes both reference-envelope delimiters and the following
user request; JSON string escapes must not be mistaken for missing multiline
evidence. Preserve original captures when auditing an observer correction and
write a separate derived receipt identifying its inputs.

The initial RAG canary returned zero local candidates for its full natural-language
question and completed without inference in grounded mode. This is a measured
retrieval miss, not successful quality acceptance. The ten-case database tuning
diagnostic completed with nine correct traces; the remaining trace contained
model-generated quotes inside a property ID and was rejected by validation.
Those tuning diagnostics preceded holdout. Current captures, interruptions and
acceptance boundaries are recorded in the [roadmap checkpoint](../../docs/development/UPSTREAM_ROADMAP_STATUS.md).
Final acceptance also requires a human-reviewed boolean
`refused` annotation for every case, including useful refusals and false abstention;
an omitted annotation cannot silently count as a successful answer.

The schema acceptance test uses a dedicated local PostgreSQL database ending in
`_test`, with no application environment file. Set `RAG_QUALITY_TEST_DATABASE_URL`
and run `corepack pnpm --filter ./apps/server exec jest --config test/jest-e2e.json
--runInBand test/rag-evidence-quality.e2e-spec.ts`. The test owns a unique schema
and verifies defaults, constraints, evidence JSON and migration rollback.
