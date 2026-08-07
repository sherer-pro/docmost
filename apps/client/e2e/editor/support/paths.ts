import path from "node:path";

export const auditRoot = path.resolve(
  process.cwd(),
  "../../output/audit/editor-2026-08-06",
);

export const auditStatePath = path.join(auditRoot, "audit-state.json");
export const screenshotsDir = path.join(auditRoot, "screenshots");
export const consoleDir = path.join(auditRoot, "console-errors");
export const axeDir = path.join(auditRoot, "axe-results");
export const downloadsDir = path.join(auditRoot, "downloads");
export const confirmedDefectsPath = path.join(
  auditRoot,
  "confirmed-defects.json",
);
