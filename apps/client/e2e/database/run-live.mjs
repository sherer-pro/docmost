import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

const args = process.argv.slice(2);
const apiOnly = args.some((arg) =>
  [
    "--api-only",
    "--startup-only",
    "--postgres-only",
    "--ai-quality",
    "--release",
    "--ai-browser-only",
    "--editor-browser-only",
  ].includes(arg),
);
// Each browser mutates its fixture through the real API and collaboration server.
// A fresh runtime prevents one browser's saved state from seeding the next one.
const runs =
  args.includes("--browser=all") && !apiOnly
    ? ["chromium", "firefox", "webkit"].map((browser) =>
        args.map((arg) =>
          arg === "--browser=all" ? `--browser=${browser}` : arg,
        ),
      )
    : [args];
for (const runArgs of runs) {
  const browser = runArgs.find((arg) => arg.startsWith("--browser="));
  if (runs.length > 1) console.log(`Fresh isolated runtime for ${browser}`);
  const child = spawn(
    process.execPath,
    [
      path.resolve(
        import.meta.dirname,
        "../../../server/test/database-tables-live.mjs",
      ),
      ...runArgs,
    ],
    { stdio: "inherit", windowsHide: true },
  );
  const [code] = await once(child, "exit");
  if (code !== 0) process.exitCode = code ?? 1;
}
