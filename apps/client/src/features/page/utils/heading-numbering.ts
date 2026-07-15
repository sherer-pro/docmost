import { PageSettings } from "@/features/page/types/page.types";
import { ISpaceSettings } from "@/features/space/types/space.types";

export type HeadingNumberingOverride = "inherit" | "enabled" | "disabled";

export function getHeadingNumberingOverride(
  pageSettings?: PageSettings,
): HeadingNumberingOverride {
  const value = pageSettings?.headingNumbering?.enabled;
  if (value === true) return "enabled";
  if (value === false) return "disabled";
  return "inherit";
}

export function resolveHeadingNumberingEnabled({
  pageSettings,
  spaceSettings,
}: {
  pageSettings?: PageSettings;
  spaceSettings?: ISpaceSettings;
}): boolean {
  const override = pageSettings?.headingNumbering?.enabled;
  if (typeof override === "boolean") {
    return override;
  }

  return spaceSettings?.headingNumbering?.enabled === true;
}
