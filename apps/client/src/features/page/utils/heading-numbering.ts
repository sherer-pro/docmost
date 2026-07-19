import { ISpaceSettings } from "@/features/space/types/space.types";
import { normalizeHeadingNumberingByPageId } from "@/features/user/utils/heading-numbering";

interface HeadingNumberingPreferences {
  headingNumberingByPageId?: unknown;
}

export function resolveHeadingNumberingEnabled({
  pageId,
  preferences,
  spaceSettings,
}: {
  pageId?: string | null;
  preferences?: HeadingNumberingPreferences | null;
  spaceSettings?: ISpaceSettings;
}): boolean {
  const overrides = normalizeHeadingNumberingByPageId(
    preferences?.headingNumberingByPageId,
  );

  if (pageId && Object.prototype.hasOwnProperty.call(overrides, pageId)) {
    return overrides[pageId];
  }

  return spaceSettings?.headingNumbering?.enabled === true;
}

export function resolveSpaceHeadingNumberingEnabled(
  spaceSettings?: ISpaceSettings,
): boolean {
  return spaceSettings?.headingNumbering?.enabled === true;
}
