import type { BatchUpdateDatabaseRowOperation } from "@docmost/api-contract";

export function parseDatabaseTsv(raw: string): string[][] {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.split("\t"));
}

export function getFailedDatabaseOperations(
  operations: BatchUpdateDatabaseRowOperation[],
  failedRows: string[],
): BatchUpdateDatabaseRowOperation[] {
  const ids = new Set(failedRows);
  return operations.filter((operation) => ids.has(operation.pageId));
}

export class DatabaseCellSaveCoordinator {
  private pending = new Map<
    string,
    { promise: Promise<unknown>; fingerprint: string }
  >();
  save<T>(
    key: string,
    operation: () => Promise<T>,
    fingerprint = "",
  ): Promise<T> {
    const running = this.pending.get(key);
    if (running?.fingerprint === fingerprint)
      return running.promise as Promise<T>;
    const promise = (
      running
        ? running.promise.catch(() => undefined).then(operation)
        : operation()
    ).finally(() => {
      if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
    });
    this.pending.set(key, { promise, fingerprint });
    return promise;
  }
}
