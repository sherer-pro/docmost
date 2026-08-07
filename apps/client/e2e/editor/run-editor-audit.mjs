import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { request } from "@playwright/test";

const require = createRequire(import.meta.url);
const clientRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(clientRoot, "../..");
const auditRoot = path.join(repoRoot, "output/audit/editor-2026-08-06");
const statePath = path.join(auditRoot, "audit-state.json");
const defectsPath = path.join(auditRoot, "confirmed-defects.json");
const baseURL = (
  process.env.DOCMOST_BASE_URL ?? "http://localhost:3000"
).replace(/\/$/, "");
const apiBaseURL = (process.env.DOCMOST_API_BASE_URL ?? baseURL).replace(
  /\/$/,
  "",
);
const apiOrigin = (process.env.DOCMOST_API_ORIGIN ?? baseURL).replace(
  /\/$/,
  "",
);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be supplied at runtime`);
  return value;
}

function unwrap(payload) {
  return payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
    ? payload.data
    : payload;
}

async function responseJson(response) {
  const text = await response.text();
  if (!response.ok()) {
    throw new Error(
      `${new URL(response.url()).pathname} failed with ${response.status()}: ${text.slice(0, 500)}`,
    );
  }
  return text ? unwrap(JSON.parse(text)) : undefined;
}

async function createApi() {
  const csrfToken = required("DOCMOST_CSRF_TOKEN");
  const authToken = required("DOCMOST_AUTH_TOKEN");
  return request.newContext({
    baseURL: apiBaseURL,
    timeout: 20_000,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authToken}`,
      Cookie: `csrfToken=${csrfToken}`,
      Origin: apiOrigin,
      Referer: `${apiOrigin}/`,
      "x-csrf-token": csrfToken,
      Accept: "application/json",
    },
  });
}

async function runPlaywright() {
  const cli = require.resolve("@playwright/test/cli");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "test", "--config=playwright.editor.config.ts"],
      {
        cwd: clientRoot,
        env: process.env,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

await fs.mkdir(auditRoot, { recursive: true });
for (const directory of [
  "axe-results",
  "console-errors",
  "downloads",
  "playwright-artifacts",
  "playwright-html",
  "screenshots",
]) {
  const generatedDirectory = path.join(auditRoot, directory);
  await fs.rm(generatedDirectory, { recursive: true, force: true });
  await fs.mkdir(generatedDirectory, { recursive: true });
}
await fs.writeFile(defectsPath, "[]\n", "utf8");
const api = await createApi();
let state;
let exitCode = 1;
let originalWorkspaceTemplatePolicy;

try {
  const runId = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  originalWorkspaceTemplatePolicy = await responseJson(
    await api.get("/api/pages/templates/policies/workspace"),
  );
  if (!originalWorkspaceTemplatePolicy.systemEnabled) {
    throw new Error("Live page embeds are disabled by the deployment policy");
  }
  if (!originalWorkspaceTemplatePolicy.enabled) {
    await responseJson(
      await api.patch("/api/pages/templates/policies/workspace", {
        data: {
          enabled: true,
          expectedRevision: originalWorkspaceTemplatePolicy.revision,
        },
      }),
    );
  }
  const space = await responseJson(
    await api.post("/api/spaces", {
      data: {
        name: `Editor audit ${runId}`,
        slug: `editoraudit${runId}`,
        description: "Isolated browser regression audit space.",
      },
    }),
  );
  state = {
    runId,
    spaceId: space.id,
    spaceSlug: space.slug,
    spaceName: space.name,
    retained: true,
    createdAt: new Date().toISOString(),
  };
  await responseJson(
    await api.patch(`/api/spaces/${space.id}`, {
      data: { disablePublicSharing: false },
    }),
  );
  const spaceTemplatePolicy = await responseJson(
    await api.get(`/api/pages/templates/policies/spaces/${space.id}`),
  );
  await responseJson(
    await api.put(`/api/pages/templates/policies/spaces/${space.id}`, {
      data: {
        ...spaceTemplatePolicy,
        templatesEnabled: true,
        allowCreateTemplate: true,
        allowSnapshot: true,
        allowLiveEmbed: true,
        allowPublicLiveEmbed: true,
        expectedRevision: spaceTemplatePolicy.revision,
      },
    }),
  );
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  exitCode = await runPlaywright();
  const confirmedDefects = JSON.parse(await fs.readFile(defectsPath, "utf8"));
  if (exitCode === 0 && confirmedDefects.length === 0) {
    await responseJson(await api.delete(`/api/spaces/${state.spaceId}`));
    state.retained = false;
    state.deletedAt = new Date().toISOString();
    await fs.writeFile(
      statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  } else {
    state.confirmedDefects = confirmedDefects.length;
    state.retainedReason = exitCode !== 0 ? "test-failure" : "confirmed-defect";
    if (exitCode !== 0) {
      state.failureExitCode = exitCode;
    }
    await fs.writeFile(
      statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8",
    );
  }
} finally {
  if (
    originalWorkspaceTemplatePolicy &&
    originalWorkspaceTemplatePolicy.systemEnabled
  ) {
    const currentPolicy = await responseJson(
      await api.get("/api/pages/templates/policies/workspace"),
    ).catch(() => null);
    if (
      currentPolicy &&
      currentPolicy.enabled !== originalWorkspaceTemplatePolicy.enabled
    ) {
      await responseJson(
        await api.patch("/api/pages/templates/policies/workspace", {
          data: {
            enabled: originalWorkspaceTemplatePolicy.enabled,
            expectedRevision: currentPolicy.revision,
          },
        }),
      ).catch(() => undefined);
    }
  }
  await api.dispose();
}

process.exitCode = exitCode;
