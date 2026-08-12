# AgentMemory and Graphify development setup

## Purpose and responsibility boundary

Graphify is the canonical source for the repository's current structure, symbols, files, documentation, and relationships. Its canonical artifact remains `graphify-out/graph.json`; use `graphify query`, `graphify explain`, and `graphify path` for current-state questions.

AgentMemory stores Codex session history, durable decisions, failed and successful approaches, recurring errors, project conventions, and unfinished work. The Graphify graph imported into AgentMemory is a bounded retrieval cache. It does not replace the current Graphify graph or source-code verification.

The active profile deliberately gives the local LLM to Graphify only. AgentMemory uses `AGENTMEMORY_PROVIDER=noop` and local embeddings, so memory capture and retrieval do not compete with Graphify's semantic extraction.

## Verified component versions

| Component | Verified version | Installation |
| --- | --- | --- |
| Codex CLI/Desktop CLI | `0.147.0` | Existing user installation |
| Graphify | `0.9.33` | Existing `uv tool` installation (`graphifyy`) |
| AgentMemory | `0.9.29` | Global user npm prefix, built from official commit `2973e4ec4c40d323a08daa34220118010e73a2c3` |
| iii-engine | `0.11.2` | AgentMemory private user runtime under `~/.agentmemory/bin` |
| Node.js | `24.16.0` | Existing user installation |

At setup time, the npm `latest` tag for `@agentmemory/agentmemory` was still `0.9.28`. That release does not include `POST /agentmemory/graph/import-graphify`; the endpoint first appears in the official `0.9.29` source. The installed `0.9.29` build is therefore pinned to the official commit above rather than silently falling back to an incompatible npm release.

Graphify `0.9.33` remains unchanged because it is working. No Graphify rebuild, reinstall, model change, endpoint change, or backend change is part of this setup.

## Detected Graphify configuration

Graphify is installed as the `graphifyy` uv tool and exposes `graphify` plus `graphify-mcp`. Repository instructions use `graphify update .`; the project-scoped Codex hook invokes `graphify hook-check`. There is no separate Graphify MCP entry in the current Codex MCP list.

The detected semantic backend is LM Studio listening on `http://127.0.0.1:56254/v1`. Graphify's selected model is `google/gemma-4-26b-a4b-qat`. The active Graphify-related process environment also contains `GRAPHIFY_MAX_RETRIES=0` and `GRAPHIFY_API_TIMEOUT=1800`; its `OPENAI_API_KEY` is set outside the repository and is never copied or displayed. LM Studio's `/v1/models` endpoint exposed three model IDs during the audit, but without the LM Studio CLI this is only the served model list, not proof that all three are simultaneously resident in VRAM.

AgentMemory scripts do not alter any of these Graphify values. `context:refresh` removes AgentMemory variables from the Graphify child while preserving the existing backend, endpoint, model, timeouts, and retry policy.

## Architecture

```text
Codex
|-- Graphify
|   |-- graphify-out/graph.json (canonical current graph)
|   |-- graphify query / explain / path / update
|   `-- existing local LLM configuration
`-- AgentMemory
    |-- Codex plugin and 8-tool core MCP surface
    |-- Codex lifecycle hooks
    |-- local embeddings, no LLM provider
    |-- ~/.agentmemory data, logs, and iii-engine runtime
    `-- bounded import of graphify-out/graph.json
```

AgentMemory data and configuration remain outside the Git worktree. The repository contains only scripts, task-runner entries, instructions, and this document.

## Active user configuration

The active file is `%USERPROFILE%\.agentmemory\.env` on Windows and `~/.agentmemory/.env` elsewhere. It contains no provider API keys.

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

The repository launcher also removes inherited OpenAI, Anthropic, Gemini, OpenRouter, and MiniMax provider variables from the AgentMemory child process. It does not remove those variables from Graphify. The Graphify refresh child receives the existing Graphify environment with AgentMemory-specific variables removed.

## Ports and data

| Port | Binding | Purpose |
| --- | --- | --- |
| `3111` | `127.0.0.1` | REST API, health, and MCP HTTP |
| `3112` | `127.0.0.1` | Internal streams |
| `3113` | `127.0.0.1` | Viewer |
| `49134` | `127.0.0.1` | iii-engine WebSocket |

The service is started on demand. No Windows startup task or service is created. AgentMemory stores its database, runtime state, logs, and backups under `~/.agentmemory`, outside this repository.

## Commands

Run from the repository root:

```bash
pnpm context:memory:start
pnpm context:memory:stop
pnpm context:memory:status
pnpm context:memory:doctor
pnpm context:graph-import
pnpm context:refresh
```

The underlying Node script resolves the Git root, so it can also be invoked from a nested directory using an absolute path to the script:

```bash
node <repo-root>/scripts/context-memory.mjs graph-import
node <repo-root>/scripts/context-memory.mjs refresh --dry-run
```

`context:memory:start` is idempotent: a healthy existing service is reported and not duplicated. It starts AgentMemory from the user-level npm installation, writes logs only under `~/.agentmemory/logs`, uses the private iii-engine runtime, and waits for health.

`context:graph-import` validates JSON and requires non-empty `nodes` and `links`/`edges` before sending only this body to the loopback API:

```json
{"cwd":"<absolute-git-root>"}
```

The endpoint reads `graphify-out/graph.json` itself. The script reports imported, new, skipped, and truncated entities and exits nonzero on validation, HTTP, or import failure.

`context:refresh` preserves the existing Graphify command and environment. It backs up the current valid graph outside the repository, runs `graphify update .`, validates the result, and imports only after success. If Graphify exits unsuccessfully, the previous valid `graph.json` is restored and no import occurs. Use `pnpm context:refresh -- --dry-run` to verify routing without updating the graph.

## Codex plugin, MCP, and hooks

The enabled plugin is `agentmemory@agentmemory` version `0.9.29`. It registers the MCP server, so there is no project-level fallback section in `.codex/config.toml` and no second manual AgentMemory MCP server.

After installation or update, fully restart Codex Desktop. The current task cannot acquire newly registered tools retroactively. Verify after restart:

```bash
codex plugin list --json
codex mcp list
node scripts/agentmemory-mcp-smoke.mjs
```

The smoke check requests all tools from the shim but expects the server-enforced 8-tool `core` surface. The autonomous fallback exposes 7 tools; receiving 8 confirms that the shim reached the running full server.

Codex Desktop plugin-local hooks are not relied on. A clean `codex exec` smoke with only plugin-local hooks left the AgentMemory session count unchanged. On Windows, AgentMemory `0.9.29` also reports that automated `agentmemory connect codex --with-hooks` is unsupported. The user-level workaround at `~/.codex/hooks.json` therefore contains one AgentMemory hook for each of these six Codex events: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, and `Stop`. The repository's Graphify `PreToolUse` hook remains in `.codex/hooks.json` at project scope.

After restarting Codex, open `/hooks` and inspect every command before trusting it. Each AgentMemory command must invoke `node` with a script under the installed `agentmemory/0.9.29/scripts` directory. There must be exactly one AgentMemory command per event and the existing Graphify hook must still be present. Do not bypass Codex hook trust prompts. Until that review is completed, a no-bypass `codex exec` smoke is expected to leave the AgentMemory session count unchanged.

## Diagnostics

1. Run `pnpm context:memory:status` and confirm `healthy`, provider `noop`, embeddings enabled, graph enabled, and compression/consolidation/context injection disabled.
2. Run `pnpm context:memory:doctor`. In this intentional no-LLM profile, the doctor marks the absent LLM key and three disabled LLM features as failures even though they are required safety settings here. Do not apply those suggested fixes. AgentMemory `0.9.29` may additionally report `iii not on PATH` when doctor is launched as a nested Windows child process; verify `~/.agentmemory/bin/iii.exe --version` and the live worker executable before treating that diagnostic as real.
3. Check `http://127.0.0.1:3111/agentmemory/health` and confirm the service and worker versions.
4. Check listeners for `3111`, `3112`, `3113`, and `49134`; they must bind only to loopback.
5. Run `node scripts/agentmemory-mcp-smoke.mjs` to distinguish the 8-tool server-backed core surface from the 7-tool fallback.
6. Run `graphify --version` and a scoped `graphify query`/`graphify explain`; do not trigger a full extraction merely to test AgentMemory.
7. Inspect `~/.agentmemory/logs` without copying logs into the repository.

## Graph import limits

AgentMemory `0.9.29` caps a Graphify import at a 32 MiB file, 5,000 nodes, and 20,000 input edges. The graph is valid and below the file-size cap, but larger than the entity caps. The first verified setup import read 14,741 nodes and 42,152 edges, imported 5,000 nodes and 12,786 edges, reported 9,741 nodes and 22,152 edges outside the cap, and skipped 7,214 edges whose endpoints were not in the retained node set. An immediate repeated import created zero new nodes and zero new edges. Counts will change as Graphify hooks update the canonical graph.

This truncation is why AgentMemory's copy is only a retrieval cache. Graphify and source code remain authoritative.

## Safe AgentMemory update

1. Stop the service and record `agentmemory --version`, `iii --version`, `codex plugin list --json`, and `codex mcp list`.
2. Back up `~/.agentmemory/.env`, `~/.codex/config.toml`, and `~/.codex/hooks.json` outside the repository. Preserve the AgentMemory data directory.
3. Read the official AgentMemory README, changelog, `.env.example`, and pairing recipe for the target version.
4. Prefer a published npm version that contains Graphify import:

   ```bash
   npm install -g @agentmemory/agentmemory@<verified-version>
   ```

5. If npm still lags and the official pinned commit is required, clone that commit to a temporary directory, install its development dependencies, build with `tsdown`, copy the package assets listed in `package.json`, run `npm pack`, and install the resulting tarball globally. Never install an unpinned fork or third-party binary.
6. Update the Codex plugin only after reviewing its manifest and hooks. Do not create a manual MCP section when the plugin already registers one.
7. Restart AgentMemory, run health/status/doctor/MCP checks, import the graph twice, and restart Codex.

## Rollback

1. Run `pnpm context:memory:stop`.
2. Disable the plugin with `codex plugin remove agentmemory@agentmemory --json`. Remove the `agentmemory` marketplace only if no other plugin uses it.
3. Restore the backed-up Codex config and merge hooks carefully; remove only AgentMemory commands, never the Graphify hook or unrelated user hooks.
4. Restore the backed-up AgentMemory `.env` if configuration rollback is needed.
5. Reinstall the previously recorded npm package version. Keep `~/.agentmemory` data unless intentional data deletion is separately approved.

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

For Ollama, convert a verified Graphify base such as `http://127.0.0.1:11434` to `http://127.0.0.1:11434/v1` only after confirming the OpenAI-compatible endpoint. Never enable per-tool automatic compression while Graphify is using the same local model.

After any successful Graphify update or rebuild, run `pnpm context:graph-import` again, or use `pnpm context:refresh` to perform the update and import in order.
