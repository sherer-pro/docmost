import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const clientRoot = path.resolve(import.meta.dirname, "../..");
const repoRoot = path.resolve(clientRoot, "../..");
const outputFile = path.join(
  repoRoot,
  "output/audit/editor-2026-08-06/added-tests.diff",
);

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

function gitDiff(args) {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.status === 1 && error.stdout) return String(error.stdout);
    throw error;
  }
}

const newFiles = [
  path.join(clientRoot, "playwright.editor.config.ts"),
  path.join(
    clientRoot,
    "src/features/editor/extensions/indent-keyboard.test.ts",
  ),
  ...(await walk(path.join(clientRoot, "e2e/editor"))),
].sort();

const changedFiles = [
  "apps/client/package.json",
  "apps/client/src/features/editor/components/diagram/diagram-attachment.test.ts",
  "apps/client/src/features/editor/components/diagram/diagram-attachment.ts",
  "apps/client/src/features/editor/components/drawio/drawio-view.tsx",
];

const parts = [
  gitDiff(["diff", "--", ...changedFiles]),
  ...newFiles.map((file) =>
    gitDiff([
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      path.relative(repoRoot, file).replaceAll("\\", "/"),
    ]),
  ),
];

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(
  outputFile,
  [
    "# pnpm-lock.yaml had unrelated pre-existing edits; its mixed diff is excluded.\n",
    ...parts.filter(Boolean),
  ].join("\n"),
  "utf8",
);

console.log(outputFile);
