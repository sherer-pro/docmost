import { PageEditMode } from "@/features/user/types/user.types.ts";
import { validate as isValidUuid } from "uuid";

/**
 * Normalize persisted/edit-mode values so UI keeps working
 * even if legacy payloads include casing/quote inconsistencies.
 */
export function normalizePageEditMode(value?: string | null): PageEditMode {
  const normalized = normalizePageEditModeValue(value);
  return normalized ?? PageEditMode.Read;
}

interface PageEditModePreferences {
  pageEditModeByPageId?: unknown;
}

interface ResolvePageEditModeInput {
  pageId?: string | null;
  preferences?: PageEditModePreferences | null;
}

function stripEnclosingQuotes(value: string): string {
  let normalized = value.trim();

  for (let i = 0; i < 5; i += 1) {
    if (
      normalized.length >= 2 &&
      normalized.startsWith('"') &&
      normalized.endsWith('"')
    ) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return normalized;
}

function normalizePageEditModeValue(value: unknown): PageEditMode | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = stripEnclosingQuotes(value).toLowerCase();
  if (normalized === PageEditMode.Read || normalized === PageEditMode.Edit) {
    return normalized as PageEditMode;
  }

  return null;
}

export function normalizePageEditModeByPageId(
  value: unknown,
): Record<string, PageEditMode> {
  let parsedValue = value;

  if (typeof parsedValue === "string") {
    try {
      parsedValue = JSON.parse(parsedValue);
    } catch {
      return {};
    }
  }

  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
    return {};
  }

  return Object.entries(parsedValue).reduce<Record<string, PageEditMode>>(
    (acc, [pageId, mode]) => {
      const normalizedMode = normalizePageEditModeValue(mode);
      if (!isValidUuid(pageId) || !normalizedMode) {
        return acc;
      }

      acc[pageId] = normalizedMode;
      return acc;
    },
    {},
  );
}

export function resolvePageEditMode({
  pageId,
  preferences,
}: ResolvePageEditModeInput): PageEditMode {
  if (!pageId) {
    return PageEditMode.Read;
  }

  const pageEditModeByPageId = normalizePageEditModeByPageId(
    preferences?.pageEditModeByPageId,
  );

  return pageEditModeByPageId[pageId] ?? PageEditMode.Read;
}

export function buildPageEditModeByPageId(
  value: unknown,
  pageId: string,
  mode: PageEditMode,
): Record<string, PageEditMode> {
  const pageEditModeByPageId = normalizePageEditModeByPageId(value);

  if (!isValidUuid(pageId)) {
    return pageEditModeByPageId;
  }

  return {
    ...pageEditModeByPageId,
    [pageId]: mode,
  };
}
