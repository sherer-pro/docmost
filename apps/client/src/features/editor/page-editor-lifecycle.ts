export function shouldActivateLiveEditor(input: {
  connectionStatus: string;
  localSynced: boolean;
  remoteSynced: boolean;
}): boolean {
  return (
    input.connectionStatus === "connected" &&
    input.localSynced &&
    input.remoteSynced
  );
}

export function resolveLiveEditorOptions<T>(
  showStatic: boolean,
  options: T,
): T | null {
  return showStatic ? null : options;
}
