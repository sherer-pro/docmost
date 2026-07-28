const WORKSPACE_ADMIN_SETTINGS_PATHS = new Set([
  "/settings/workspace",
  "/settings/security",
  "/settings/api-keys",
  "/settings/ai",
  "/settings/billing",
  "/settings/license",
]);

export function canAccessSettingsPath(path: string, isAdmin: boolean) {
  return isAdmin || !WORKSPACE_ADMIN_SETTINGS_PATHS.has(path);
}
