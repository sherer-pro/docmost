import {
  closeSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";

export async function withDeploymentLock(stateFile, operation, callback) {
  if (!stateFile) return callback();
  const path = `${realpathSync(stateFile)}.operation.lock`;
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error(
        "Deployment operation is locked; inspect the owner before removing a stale lock",
      );
    throw error;
  }
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({
        token,
        pid: process.pid,
        operation,
        createdAt: new Date().toISOString(),
      }),
    );
    return await callback();
  } finally {
    closeSync(descriptor);
    try {
      if (JSON.parse(readFileSync(path, "utf8")).token === token)
        unlinkSync(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
