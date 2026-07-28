import { describe, expect, it } from "vitest";
import { canAccessSettingsPath } from "./workspace-settings-access";

describe("workspace settings navigation access", () => {
  it.each([
    "/settings/workspace",
    "/settings/security",
    "/settings/api-keys",
    "/settings/ai",
    "/settings/billing",
    "/settings/license",
  ])("hides configuration path %s from workspace members", (path) => {
    expect(canAccessSettingsPath(path, false)).toBe(false);
    expect(canAccessSettingsPath(path, true)).toBe(true);
  });

  it.each([
    "/settings/account/profile",
    "/settings/account/preferences",
    "/settings/account/api-keys",
    "/settings/members",
    "/settings/groups",
    "/settings/spaces",
    "/settings/sharing",
  ])("keeps non-configuration path %s visible to workspace members", (path) => {
    expect(canAccessSettingsPath(path, false)).toBe(true);
  });
});
