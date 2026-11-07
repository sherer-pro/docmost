# AgentMemory and Graphify development integration

This is local development tooling, separate from the Docmost application's AI.

## Installed contract

The supported installation on this Windows host is AgentMemory CLI `0.9.32`,
qualified runtime `0.9.32-my-context.2`, iii-engine `0.25.0`, and Graphify `0.9.33`.
The full Graphify v2 protocol belongs to that installed runtime extension;
do not attribute it to an unmodified npm release or to the Sherer plugin.
Inspect installed CLI help, runtime checksums and API capabilities before changes.
Repository commands do not install or upgrade components.

## Shared service and client

One user service stores data outside the repository at `~/.agentmemory/data`.
Changing its profile, hooks, process or startup policy affects other projects.
Coordinate service ownership. Use separate HOME, data directory, namespace and
ports for tests; inspect the generated Compose file and actual processes.
The CLI's `--instance` also changes the resolved data-directory layout.

The existing `AgentMemory Startup` scheduled task invokes
`~/.agentmemory/bin/start-service.ps1`. The repository start command reuses that
qualified launcher and preserves its policy. Its existing log-preparation helper
preserves a full Compose engine log before starting iii on Windows; include that
step in faithful isolated cold-start tests. It does not change engine readiness.

| Purpose | Loopback port |
| --- | --- |
| REST API and SSE | 3111 |
| Viewer | 3113 |
| iii engine | 49134 |

The retired stream port 3112 is not required. Verify listener addresses, data
directory and process ownership independently of HTTP health.

Exactly one user-level Codex MCP registration invokes
`~/.agentmemory/bin/codex-mcp.mjs` through Node. The project config does not
override it. This authenticated proxy neither starts the service nor opens a
fallback store; its fixed shared profile is not an isolated-instance launcher.
Use `codex mcp list --json` in the target cwd and redact credentials before saving
output. Preserve the six user lifecycle hooks, separate project Graphify hook,
unrelated configuration and existing hook trust. Configuration, actual hook
execution, live MCP handshake and tools in the current session are separate checks.

## LLM and embeddings

The [secret-free profile](development/agentmemory.env.example) keeps
`AGENTMEMORY_PROVIDER=noop`, `AGENTMEMORY_LLM_PROVIDER` empty, auto-compression,
consolidation and forgetting disabled. Keep generative AgentMemory LLM features
off during diagnostics and retrieval pilots.

`EMBEDDING_PROVIDER=local` is independent of generative LLM selection. Model
availability alone does not prove index completeness: compare eligible stored
IDs, BM25 coverage, persisted vectors, dimension, pending work and restart
behavior. A complete existing index needs no backfill. Test any required bounded
backfill on an isolated copy first.

The REST client resolves the existing local secret using installed `bin/auth.mjs`.
Never print it or place it in a URL, command-line argument or tracked file.

## Graphify and provenance

`.graphify-local.json` pins the root corpus, local model and resource limits.
`.graphifyignore` excludes dependencies, secrets, generated data, audit artifacts
and all canonical/staging/previous graph outputs. Query memory remains outside
the corpus at `~/.graphify/query-memory/docmost`.

`graphify:rebuild` uses the already installed model on the discovered loopback
LM Studio endpoint, without a download or cloud fallback, and writes staging.
The source snapshot records detected paths and content fingerprints. Acceptance
checks manifest coverage and hashes, graph references, source paths, graph bytes
and the original extraction provenance. Report zero-node files and unverified
semantic locations; do not treat exit status or a nonempty graph as completeness.

An older cloud graph cannot become a local extraction by relabeling communities,
sanitizing paths or replacing hashes. Retain the previous artifact set until the
new set passes acceptance. Keep failed staging and compatible caches for bounded
recovery. Code-only drift requires a real AST update; changed documents require
the corresponding semantic extraction.

## Full graph import

`context:graph-import` requires the repository's strict graph gate and the
`/agentmemory/graphify/v2/capabilities` contract. It uses explicit
`projectKey=docmost`, `sourceKey=graphify`, bounded batches and complete original
nodes, edges, hyperedges, attributes, root metadata and provenance.

The server checks counts, references and canonical digest before publishing a
generation. The client reads every object back with generation-bound pagination,
reconstructs the graph and verifies digest, provenance and same-generation
idempotency. Replacement snapshots remove disappeared objects from the active
view; previous generation files are retained. Verify foreign scopes separately.
The legacy bounded importer and zero-new-object counts do not prove completeness.

## Commands and acceptance

Use Corepack with `context:memory:start`, `context:memory:status`,
`context:memory:doctor`, `context:memory:smoke`, `graphify:check`,
`graphify:rebuild`, `context:graph-import -- --assert-idempotent`, and
`context:verify` from the repository root.

`context:memory:stop` affects every project using the shared service. The self-test
command writes and deletes a memory; do not run it on working data when the task
requires isolation. Official evaluations also belong in separate stores.
An exact-marker round trip verifies transport and persistence, not semantic
quality. Trace real capture IDs and project identity through API, viewer and MCP.
Smart-search expansion returns summaries; distinguish them from retained replay
sources and original session transcripts.

Before changes, back up the consistent store, configuration and complete graph
artifact set. Check hashes, source stability and opening an isolated copy.
Restrict ACLs on configuration backups containing credentials. Rollback restores
only changed settings or the project's graph generation. Never overlay an old
shared data directory over newly captured records.

Keep dated evidence in an ignored `artifacts/` directory. Separately report
service availability, capture/retrieval, measured usefulness, graph provenance,
import completeness, cold-start behavior and client acceptance. Explicitly retain
partial chunks, unavailable checks and browser/tooling failures in the result.
