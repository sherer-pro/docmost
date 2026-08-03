const WORKSPACE_ADMIN_SETTINGS_PATHS = new Set([
  "/settings/workspace",
  "/settings/security",
  "/settings/api-keys",
  "/settings/account/api-keys",
  "/settings/ai",
  "/settings/keys",
  "/settings/keys/mcp",
  "/settings/keys/rag",
]);

export function canAccessSettingsPath(path: string, isAdmin: boolean) {
  return isAdmin || !WORKSPACE_ADMIN_SETTINGS_PATHS.has(path);
}

export function isSettingsItemActive(pathname: string, itemPath: string) {
  if (itemPath === "/settings/ai") {
    return (
      pathname === itemPath || pathname.startsWith("/settings/ai/spaces/")
    );
  }

  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
