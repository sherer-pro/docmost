import type { RagSyncSpaceConfig } from "@docmost/api-contract";

export function getRagSyncWorkflowStep(
  config: RagSyncSpaceConfig,
  hasSavedTarget: boolean,
) {
  if (config.state === "enabled") return 3;
  if (config.target.lastTestedAt) return 2;
  if (hasSavedTarget) return 1;
  return 0;
}

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
