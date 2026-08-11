const STORAGE_PREFIX = 'docmost:pending-import:';

function storageKey(spaceId: string): string {
  return `${STORAGE_PREFIX}${spaceId}`;
}

export function loadPendingDocmostImport(spaceId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(storageKey(spaceId)) ?? null;
  } catch {
    return null;
  }
}

export function storePendingDocmostImport(
  spaceId: string,
  fileTaskId: string,
): void {
  try {
    globalThis.localStorage?.setItem(storageKey(spaceId), fileTaskId);
  } catch {
    // Import processing continues server-side when browser storage is blocked.
  }
}

export function clearPendingDocmostImport(spaceId: string): void {
  try {
    globalThis.localStorage?.removeItem(storageKey(spaceId));
  } catch {
    // There is nothing else to clean up when browser storage is blocked.
  }
}
