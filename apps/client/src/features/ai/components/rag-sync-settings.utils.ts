import type { RagSyncSpaceConfig } from "@docmost/api-contract";

export function canEnableRagSync(
  config: RagSyncSpaceConfig,
  options: {
    isBusy: boolean;
    hasSavedTarget: boolean;
    hasUnsavedChanges: boolean;
  },
) {
  return Boolean(
    config.state === "disabled" &&
      !config.cleanupRequired &&
      config.deploymentEnabled &&
      config.target.lastTestedAt &&
      options.hasSavedTarget &&
      !options.hasUnsavedChanges &&
      !options.isBusy,
  );
}
