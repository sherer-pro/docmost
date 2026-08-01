# Documentation Audit 2026-08-01

> Historical snapshot of the AI/RAG/MCP-focused audit. Current behavior is
> defined by code, generated route inventory, and the canonical documents
> linked from `AGENTS.md`.

## Scope and sources of truth

The audit covered `README.md`, `ARCHITECTURE.md`, `AGENTS.md`, the AI/RAG/MCP
documents, the RAG Postman collection, relevant package scripts and CI, Docker
and Compose configuration, environment validation, migrations, controllers,
DTOs, services, tests, and `apps/rag-sync`. Unrelated product documentation was
mapped and spot-checked but not audited line by line.

Sources of truth, in order of authority:

1. executable controllers, DTOs, services, guards, workers, and migrations;
2. generated backend route inventory and checked-in environment examples;
3. automated tests, build configuration, CI, and container configuration;
4. `AI_ASSISTANT_AND_RAG.md` for architecture and recovery;
5. `RAG_API.md` for the external synchronization wire contract;
6. `AI_INTEGRATION.md` for operator setup and troubleshooting.

## Resolved findings

| Finding | Evidence | Resolution |
| --- | --- | --- |
| AI limits and reasoning behavior drifted in `AI_INTEGRATION.md`. | `ai.constants.ts`, provider SSE parsing, run execution, client reasoning UI | Corrected limits and reasoning behavior; marked the file as an operator guide that links to the canonical architecture. |
| RAG API-key list semantics and Postman examples still used retired own/admin views. | `ListApiKeysDto`, `ApiKeyService.listApiKeys`, settings routes | Documented workspace `owner|admin` semantics, added explicit `keyType: rag`, removed the own-key example, and added `check:rag-docs`. |
| The Postman collection omitted blocked-scope and attachment delta feeds. | `RagController`, generated route inventory | Added all missing requests, independent attachment checkpoints, and cursor/limit examples. |
| RAG Sync logging descriptions contradicted the low-cardinality implementation contract. | `RagSynchronizer.log`, cycle logging | Standardized the contract: no stable binding, space, source, checkpoint, or fingerprint IDs. |
| The chat input exposed a plain textarea despite the assistant's Markdown contract. | `AiPanel`, editor-ext Markdown converters, AI message rendering | Replaced it with a bounded Markdown-aware TipTap composer that preserves the existing Markdown API and send shortcut; added input-rule, paste, round-trip, and sanitization tests. |
| Fork-specific onboarding and recovery procedures were fragmented. | root scripts, env examples, Compose files, queue/reconciler and sync code | Added a local README quick start and a canonical recovery/diagnostics section. |
| The previous documentation audit could be mistaken for current behavior. | dated audit contents | Marked dated audit files as historical snapshots. |

## Verification and limitations

Verified with route-inventory drift checks, `check:rag-docs`, environment
contract analysis, no-fix lint, server/client/RAG Sync tests, security tests,
monorepo builds, Compose rendering, Dockerfile checks, JSON parsing, and local
relative-link checks. No production credentials, provider, retrieval service,
Open WebUI instance, migrations, destructive recovery, or live-data fault
injection were used.

`check:env` did not pass against the developer's ignored local `.env`: the file
does not yet contain the current RAG/MCP admission variables and still contains
retired provider variables. No values were displayed or changed. The checked-in
env examples and executable validation contract were reviewed separately.

The exact CI dependency gate (`check:audit-exceptions` followed by
`pnpm audit --prod --audit-level high`) passed. The unrestricted production
audit reported 16 registry advisories: 4 low, 10 moderate, and 2 high covered by
the repository's validated exception journal. Their runtime applicability was
not reclassified in this scoped implementation pass; dependencies and the
lockfile were not changed.
