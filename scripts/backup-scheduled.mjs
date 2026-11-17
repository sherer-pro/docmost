import { spawn } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments, createContext, composeArgs } from "./backup.mjs";
import { sha256File, BACKUP_SCHEMA } from "./backup-lib.mjs";
import { withDeploymentLock } from "./deployment-lock.mjs";

let activeChild;
export async function runScheduledCommand(binary, args) {
  return new Promise((ok, fail) => {
    const child = spawn(binary, args, {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    let output = "";
    let diagnostic = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-4096);
    });
    child.on("error", fail);
    child.on("close", (code) => {
      activeChild = undefined;
      if (code === 0) ok(output);
      else {
        const error = new Error(`scheduled_backup_command_failed_${code}`);
        error.exitCode = code;
        error.detail = diagnostic
          .split(/\r?\n/u)
          .find((line) => line.startsWith("Backup operation failed:"))
          ?.slice(0, 1024);
        fail(error);
      }
    });
  });
}

function atomicJson(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporary, path);
}

export async function scheduledBackup(options, execute = runScheduledCommand) {
  if (!options.yes || !options.stateFile || !isAbsolute(options.archive || ""))
    throw new Error("scheduled_backup_requires_yes_state_and_absolute_archive");
  const context = createContext(options);
  const directory = join(dirname(context.stateFile), "scheduled-backup");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const receiptPath = join(directory, "receipt.json");
  if (!existsSync(receiptPath))
    writeFileSync(receiptPath, "{}\n", { mode: 0o600, flag: "wx" });
  return withDeploymentLock(receiptPath, "scheduled-backup", async () => {
    const compose = (...args) =>
      execute("docker", composeArgs(context, ...args));
    const running = (await compose("ps", "--status", "running", "--services"))
      .trim()
      .split(/\s+/u)
      .filter((name) => ["docmost", "collab"].includes(name));
    const temporary = mkdtempSync(
      join(dirname(options.archive), ".docmost-native-"),
    );
    chmodSync(temporary, 0o700);
    const archive = join(temporary, "archive.tar");
    let phase = "create";
    let published = false;
    let createError;
    let interrupted = false;
    const signal = () => {
      interrupted = true;
      if (phase === "create" && activeChild?.pid) {
        try {
          if (process.platform === "win32") activeChild.kill("SIGTERM");
          else process.kill(-activeChild.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    };
    process.once("SIGTERM", signal);
    process.once("SIGINT", signal);
    try {
      let created;
      try {
        const inputs = [
          ...options.envFiles.flatMap((path) => ["--env-file", path]),
          "--state-file",
          options.stateFile,
          ...options.composeFiles.flatMap((path) => ["--compose-file", path]),
        ];
        created = JSON.parse(
          await execute(process.execPath, [
            fileURLToPath(new URL("./backup.mjs", import.meta.url)),
            "create",
            "--archive",
            archive,
            ...inputs,
            "--yes",
            "--json",
          ]),
        );
        if (
          created.status !== "created" ||
          created.manifest?.schema !== BACKUP_SCHEMA
        )
          throw new Error("scheduled_backup_create_result_invalid");
      } catch (error) {
        createError = error;
        throw error;
      } finally {
        phase = "resume";
        if (running.length) {
          await compose("start", ...running);
          const ids = (await compose("ps", "--all", "-q", ...running))
            .trim()
            .split(/\s+/u)
            .filter(Boolean);
          if (ids.length !== running.length)
            throw new Error("scheduled_backup_writer_missing");
          for (let attempt = 0; ; attempt += 1) {
            const states = JSON.parse(
              await execute("docker", ["inspect", ...ids]),
            );
            if (
              states.every(
                (c) => c.State.Running && c.State.Health?.Status === "healthy",
              )
            )
              break;
            if (attempt >= 90)
              throw new Error("scheduled_backup_writer_unhealthy");
            await new Promise((done) => setTimeout(done, 1000));
          }
        }
      }
      if (interrupted) throw new Error("scheduled_backup_interrupted");
      phase = "publish";
      chmodSync(archive, 0o600);
      await execute("setfacl", ["-m", "u:pullbackup:r--", archive]);
      const sha256 = await sha256File(archive);
      const bytes = statSync(archive).size;
      const fd = openSync(archive, "r+");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(archive, options.archive);
      published = true;
      if (process.platform !== "win32") {
        const parent = openSync(dirname(options.archive), "r");
        try {
          fsyncSync(parent);
        } finally {
          closeSync(parent);
        }
      }
      const receipt = {
        status: "published",
        schema: BACKUP_SCHEMA,
        archive: options.archive,
        sha256,
        bytes,
        createdAt: created.manifest.createdAt,
      };
      atomicJson(receiptPath, receipt);
      return receipt;
    } catch (error) {
      atomicJson(join(directory, "last-error.json"), {
        phase: error === createError ? "create" : phase,
        at: new Date().toISOString(),
        reason: error.message.startsWith("scheduled_backup_")
          ? error.message
          : "scheduled_backup_failed",
        exitCode: error.exitCode,
        detail: error.detail,
        previousArchiveRetained: !published,
      });
      throw error;
    } finally {
      process.removeListener("SIGTERM", signal);
      process.removeListener("SIGINT", signal);
      rmSync(temporary, { recursive: true, force: true });
    }
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  scheduledBackup(
    parseArguments([
      "create",
      ...(process.argv[2] === "--"
        ? process.argv.slice(3)
        : process.argv.slice(2)),
    ]),
  )
    .then((receipt) => console.log(JSON.stringify(receipt)))
    .catch(() => {
      console.error(
        "Scheduled backup failed; inspect private scheduled-backup/last-error.json and service journal",
      );
      process.exitCode = 1;
    });
}
