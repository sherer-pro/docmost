import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

// The runtime owns backend dependencies; this entry point only starts its CLI.
const child = spawn(
  process.execPath,
  [
    path.resolve(
      import.meta.dirname,
      "../../../server/test/database-tables-live.mjs",
    ),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", windowsHide: true },
);
const [code] = await once(child, "exit");
process.exitCode = code ?? 1;
