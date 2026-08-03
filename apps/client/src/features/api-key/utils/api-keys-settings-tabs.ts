import type { ApiKeyType } from "@/features/api-key/types/api-key.types.ts";

export const API_KEYS_SETTINGS_TABS: ApiKeyType[] = ["mcp", "rag"];

export const API_KEYS_SETTINGS_DEFAULT_TAB: ApiKeyType = "mcp";

export function isApiKeysSettingsTab(
  value: string | null | undefined,
): value is ApiKeyType {
  return API_KEYS_SETTINGS_TABS.includes(value as ApiKeyType);
}
