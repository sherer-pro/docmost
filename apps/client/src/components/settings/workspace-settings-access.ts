const WORKSPACE_ADMIN_SETTINGS_PATHS = new Set([
  "/settings/workspace",
  "/settings/security",
  "/settings/api-keys",
  "/settings/account/api-keys",
  "/settings/ai",
  "/settings/ai/spaces",
  "/settings/ai/external-tools",
  "/settings/keys",
  "/settings/keys/mcp",
  "/settings/keys/rag",
]);

export function canAccessSettingsPath(path: string, isAdmin: boolean) {
  return isAdmin || !WORKSPACE_ADMIN_SETTINGS_PATHS.has(path);
}

export function isSettingsItemActive(pathname: string, itemPath: string) {
  // The AI item used to need a special case for its per-space child routes.
  // Now that /settings/ai has tabs, the generic prefix rule covers both
  // /settings/ai/spaces and /settings/ai/external-tools as well.
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
