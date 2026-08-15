# AgentMemory and Graphify development setup

## Unified local profile

The tracked `.graphify-local.json` is the schema-v1 source for the root corpus,
Graphify `0.9.33`, and the local semantic profile. `corepack pnpm
graphify:rebuild` discovers the active loopback LM Studio endpoint, requires
`google/gemma-4-26b-a4b-qat`, builds in `graphify-out.next`, runs provenance and
integrity gates, and promotes only a valid graph. This large corpus uses
`--no-viz`; `graphify:refresh` remains the fast AST-only operation.

Query memory lives outside the corpus at `~/.graphify/query-memory/docmost` and
the save/reflect scripts pass it explicitly. AgentMemory stays on the shared
loopback `0.9.29` noop/local profile with the project MCP pin
`@agentmemory/mcp@0.9.28` and a 120-second startup timeout. Git and Codex hooks
never launch the LLM. Use `context:rebuild`, `context:refresh`, and
`context:verify` for the combined flows.

This document describes the development-only AgentMemory integration that complements the existing Graphify knowledge graph. It does not change Docmost application runtime dependencies or Graphify's model/backend configuration.

## Verified toolchain

| Component | Version | Installation |
| --- | --- | --- |
| Codex CLI/Desktop CLI | `0.147.0` at initial setup | Existing user installation |
| Graphify | `0.9.33` at initial setup | Existing `uv tool` installation (`graphifyy`) |
| AgentMemory server | `0.9.29` | Global user npm prefix, built from official commit `2973e4ec4c40d323a08daa34220118010e73a2c3` |
| AgentMemory MCP shim | `0.9.28` | Published package pinned in `.codex/config.toml` |
| iii-engine worker | `0.11.2` | AgentMemory private user runtime under `~/.agentmemory/bin` |

At setup time, the npm `latest` tag for `@agentmemory/agentmemory` was still `0.9.28`. That release does not include `POST /agentmemory/graph/import-graphify`; the endpoint first appears in the official `0.9.29` source. The installed server is therefore pinned to the official commit above. The separately published `@agentmemory/mcp` package has no `0.9.29` release, so the manual Codex registration pins the verified `0.9.28` shim.

Graphify remains unchanged because it is working. Do not alter its local LLM backend, endpoint, model, context window, token budget, `GRAPHIFY_MAX_RETRIES`, or `GRAPHIFY_API_TIMEOUT` as part of AgentMemory maintenance.

## Architecture and authority

```text
repository source + graphify-out/graph.json
    |
    |  scripts/context-memory.mjs
    |  validates, refreshes, imports, verifies, self-tests
    v
shared loopback AgentMemory service
    |-- one database for all user repositories
    |-- one set of ports and one user hook set
    |-- local embeddings, no LLM provider
    `-- bounded copy of Graphify entities

Codex in this trusted repository
    |-- project .codex/config.toml
    |-- pinned @agentmemory/mcp@0.9.28 shim
    `-- shared ~/.codex/hooks.json plus project Graphify hook
```

Graphify and the repository source are authoritative. The AgentMemory graph import is a bounded retrieval cache. AgentMemory stores cross-session decisions and observations; it must not replace current source verification.

## Shared machine service

AgentMemory is one shared machine service for every repository used by this account. The repositories share:

- one AgentMemory database and data directory;
- REST, stream, viewer, and iii-engine ports;
- one `~/.agentmemory/.env` profile;
- one `~/.codex/hooks.json` lifecycle-hook set.

Changing the shared profile or hooks can affect every repository. Always use read -> merge -> atomic write, preserve unrelated entries, and create a backup only when the content will actually change. `pnpm context:memory:stop` stops the service for every repository using it, not only Docmost.

## Safe profile

The versioned secret-free template is [`docs/development/agentmemory.env.example`](development/agentmemory.env.example). Copy it to `~/.agentmemory/.env` and review the shared-service impact before changing it. The active profile must keep:

```ini
AGENTMEMORY_PROVIDER=noop
OPENAI_API_KEY_FOR_LLM=false
EMBEDDING_PROVIDER=local
AGENTMEMORY_AUTO_COMPRESS=false
CONSOLIDATION_ENABLED=false
GRAPH_EXTRACTION_ENABLED=true
AGENTMEMORY_ALLOW_AGENT_SDK=false
AGENTMEMORY_INJECT_CONTEXT=false
AGENTMEMORY_TOOLS=core
TOKEN_BUDGET=1000
AGENTMEMORY_URL=http://127.0.0.1:3111
III_REST_PORT=3111
III_STREAM_PORT=3112
III_VIEWER_PORT=3113
III_ENGINE_PORT=49134
AGENTMEMORY_VIEWER_HOST=127.0.0.1
AGENTMEMORY_III_VERSION=0.11.2
AGENTMEMORY_DATA_DIR=~/.agentmemory/data
```

Before `start`, `status`, `doctor`, `graph-import`, and `refresh`, the repository launcher validates the shared profile. It fails closed for provider keys, a provider other than `noop`, a non-loopback HTTP URL, or a data directory inside the repository. Other differences emit warnings because the file is shared. `AGENTMEMORY_URL` can be overridden by the process environment, but both the file and override must be loopback HTTP. `~` in the data path is expanded before a child process receives it.

The launcher removes inherited OpenAI, Anthropic, Gemini, OpenRouter, MiniMax, Voyage, and Cohere provider credentials from the AgentMemory child. The Graphify refresh child receives the existing Graphify environment with all `AGENTMEMORY_*` variables plus embedding/consolidation/graph-extraction/token-budget, iii port, and `OPENAI_API_KEY_FOR_LLM` variables removed. It does not modify Graphify configuration.

## Ports and service lifecycle

| Port | Required bind | Purpose |
| --- | --- | --- |
| `3111` | `127.0.0.1` | AgentMemory REST API |
| `3112` | `127.0.0.1` | AgentMemory stream |
| `3113` | `127.0.0.1` | Viewer |
| `49134` | `127.0.0.1` | iii-engine WebSocket |

The service starts on demand. No Windows startup task or service is created. When Docker is available, `context:memory:start` preserves the existing policy check: exactly one matching iii-engine container on port `3111`, `docker update --restart=no`, then confirmation through `docker inspect`. When Docker is not installed, only that policy check is skipped and the already-started native service remains successful.

AgentMemory data, runtime state, logs, refresh backups, and the private iii executable stay under `~/.agentmemory`, outside this repository.

## Commands

Run through Corepack from the repository root:

```bash
corepack pnpm context:memory:start
corepack pnpm context:memory:stop
corepack pnpm context:memory:status
corepack pnpm context:memory:doctor
corepack pnpm context:memory:smoke
corepack pnpm context:memory:selftest
corepack pnpm context:graph-import
corepack pnpm context:graph-import -- --assert-idempotent
corepack pnpm context:refresh -- --dry-run
corepack pnpm context:refresh
corepack pnpm context:verify
```

- `context:memory:start` is idempotent. It reuses a healthy service, otherwise starts the global AgentMemory CLI with the validated child environment and writes logs under `~/.agentmemory/logs`.
- `context:memory:status` and `context:memory:doctor` validate the profile before invoking the AgentMemory CLI.
- `context:memory:smoke` starts the pinned MCP shim twice, measures the autonomous fallback and live-server tool surfaces, and requires a distinct server-backed surface containing `memory_smart_search`. It does not rely on a hard-coded tool count.
- `context:memory:selftest` writes a unique `agentmemory-selftest-<timestamp>` memory, finds it with `/agentmemory/smart-search`, deletes it through the governance API, and verifies cleanup.
- `context:graph-import` validates non-empty nodes and edges in `graphify-out/graph.json` before calling `/agentmemory/graph/import-graphify` with the absolute Git root, then waits for stable health after the heavy import. `--assert-idempotent` repeats the import, waits again, and requires zero `newNodes` and zero `newEdges`.
- `context:refresh -- --dry-run` is read-only. A real refresh enumerates `git ls-files graphify-out`, backs up every tracked artifact under a repository-hash directory in `~/.agentmemory/graphify-backups`, runs the existing `graphify update .`, validates the graph, and imports it. A failed update/validation/import restores the complete tracked set and retains that single backup for inspection or retry. Re-running after a failure reuses it only when its hashes still match the current tracked artifacts, so backups do not accumulate. The backup is removed only after the full operation succeeds and only after its resolved path is verified beneath the expected backup parent.
- `context:verify` is read-only and exits nonzero on any mismatch. It checks health and versions, the safe profile, four loopback listeners, the external data directory, exactly one AgentMemory MCP entry while preserving `node_repl`, six user hooks and their script paths, the project Graphify hook, MCP smoke, and the existing graph.

Do not run a full `graphify .` merely to test this integration. Use the current valid graph and scoped `graphify query`/`graphify explain` commands.

## Codex MCP and hooks

The earlier setup documentation incorrectly claimed that `agentmemory@agentmemory 0.9.29` was installed as a Codex plugin. It was not present in `codex plugin list --json`, its marketplace was absent, and `codex mcp list` initially contained only `node_repl`.

This repository now uses the supported project-scoped manual registration in `.codex/config.toml`:

```toml
[mcp_servers.agentmemory]
command = "npx"
args = ["-y", "@agentmemory/mcp@0.9.28"]
env = { AGENTMEMORY_URL = "http://127.0.0.1:3111", AGENTMEMORY_TOOLS = "core" }
enabled = true
required = true
startup_timeout_sec = 120
```

This choice avoids inventing a missing plugin/marketplace and pins the last published shim version that was tested against the live `0.9.29` server. Do not install or enable the plugin while this manual section is active; plugin plus manual registration would duplicate the server.

The six existing AgentMemory hooks are user-level entries in `~/.codex/hooks.json`. They invoke scripts under the global npm package at `%APPDATA%\npm\node_modules\@agentmemory\agentmemory\plugin\scripts\*.mjs` for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, and `Stop`. The repository's `.codex/hooks.json` remains separate and retains the existing `graphify.EXE hook-check` `PreToolUse` hook.

After changing MCP configuration or hooks, fully restart Codex Desktop. A running task cannot acquire newly registered MCP tools retroactively. After restart:

```bash
codex mcp list
corepack pnpm context:memory:smoke
corepack pnpm context:verify
```

Then open `/hooks` and inspect each command. Never use `--dangerously-bypass-hook-trust`. Until restart and manual `/hooks` review, report the MCP integration as configured and CLI-visible, not as proven active in a new Codex session.

## Diagnostics

1. Run `corepack pnpm context:memory:status` and confirm a healthy service with provider `noop`, local embeddings, graph extraction enabled, and compression/consolidation/context injection disabled.
2. Run `corepack pnpm context:memory:doctor`. In this intentional no-LLM profile, doctor marks the absent LLM key and three disabled LLM features as failures even though they are required safety settings here. Do not apply those suggested fixes.
3. AgentMemory `0.9.29` may report `iii not on PATH` when doctor is launched as a nested Windows child. Verify `~/.agentmemory/bin/iii.exe --version` and the live worker executable before treating it as a real failure.
4. Run `corepack pnpm context:verify` for the full integration contract and recovery hints.
5. Inspect `~/.agentmemory/logs` without copying logs or secrets into the repository.

## Graph import limits

AgentMemory `0.9.29` caps a Graphify import at a 32 MiB file, 5,000 nodes, and 20,000 input edges. During the initial verified import, it read 14,741 nodes and 42,152 edges, imported 5,000 nodes and 12,786 edges, reported 9,741 nodes and 22,152 edges outside the cap, and skipped 7,214 edges whose endpoints were not retained. The immediate repeated import created zero new nodes and zero new edges. Current graph counts can differ as Graphify hooks update the canonical graph; use `--assert-idempotent` to verify the current import programmatically.

This truncation is why AgentMemory's copy is only a retrieval cache. Graphify and source code remain authoritative.

## Safe AgentMemory update

1. Stop the shared service only after confirming that no other repository needs it. Record the AgentMemory server/worker versions, `codex plugin list --json`, and `codex mcp list`.
2. Read `~/.agentmemory/.env`, `~/.codex/config.toml`, and `~/.codex/hooks.json`; merge changes atomically and back up a file only when its content will change. Preserve AgentMemory data and unrelated Codex entries.
3. Read the official AgentMemory README, changelog, `.env.example`, pairing recipe, and the published MCP shim versions for the target release.
4. Prefer a published server package that contains Graphify import. If npm still lags and an official pinned commit is required, build only that reviewed commit and never install an unpinned fork or third-party binary.
5. Keep exactly one Codex registration method. Update the pinned project shim only after testing its fallback and server-backed surfaces. Do not add the server package to any Docmost workspace dependency.
6. Restart AgentMemory, run status/doctor/verify/selftest, import the graph with `--assert-idempotent`, restart Codex, and inspect `/hooks` without bypassing trust.

## Rollback

1. Stop the shared service only after coordinating with other repositories.
2. Remove only `[mcp_servers.agentmemory]` and its env table from `.codex/config.toml`; preserve `.codex/hooks.json` and its Graphify hook.
3. If user-level hooks or configuration must be rolled back, use read -> merge -> atomic write and remove only AgentMemory-owned entries. Preserve unrelated MCP servers, hooks, and settings.
4. Restore a previous `~/.agentmemory/.env` only if the profile itself changed. Keep `~/.agentmemory/data` unless data deletion is separately approved.
5. Reinstall the previously recorded global AgentMemory package and worker versions, then rerun the verification sequence.

## Data and security guidance

AgentMemory can retain prompts, session lifecycle events, tool observations, durable memories, project/file associations, imported graph entities, and operational logs. Do not put secrets, credentials, private keys, raw `.env` contents, personal data, or large tool dumps into prompts or memory tools. A loopback bind reduces network exposure but does not make unsafe stored content harmless.

## Optional future local-LLM profile (not active)

Only consider this after the no-LLM profile has worked for several sessions, Graphify is idle, the machine has enough RAM/VRAM, and the user accepts the extra computation. Verify that the local service implements `/v1/chat/completions` and that the selected model produces short structured answers.

```ini
AGENTMEMORY_PROVIDER=openai
OPENAI_API_KEY=local
OPENAI_BASE_URL=http://127.0.0.1:<port>/v1
OPENAI_MODEL=<detected-local-model>
EMBEDDING_PROVIDER=local
AGENTMEMORY_AUTO_COMPRESS=false
CONSOLIDATION_ENABLED=false
AGENTMEMORY_INJECT_CONTEXT=false
```

For Ollama, convert a verified Graphify base such as `http://127.0.0.1:11434` to `http://127.0.0.1:11434/v1` only after confirming the OpenAI-compatible endpoint. Never enable per-tool automatic compression while Graphify uses the same local model.

After a successful Graphify update or rebuild, run `corepack pnpm context:graph-import -- --assert-idempotent`, or use `corepack pnpm context:refresh` to update, validate, and import in order.
