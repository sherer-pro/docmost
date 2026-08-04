import { describe, expect, it } from "vitest";
import {
  canAccessSettingsPath,
  isSettingsItemActive,
} from "./workspace-settings-access";

describe("workspace settings navigation access", () => {
  it.each([
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
  ])("hides configuration path %s from workspace members", (path) => {
    expect(canAccessSettingsPath(path, false)).toBe(false);
    expect(canAccessSettingsPath(path, true)).toBe(true);
  });

  it("keeps the member-accessible per-space AI route visible", () => {
    // The admin set is matched exactly, so a space slug below /settings/ai
    // stays reachable by a space administrator who is not a workspace admin.
    expect(canAccessSettingsPath("/settings/ai/spaces/demo", false)).toBe(true);
  });

  it.each([
    "/settings/account/profile",
    "/settings/account/preferences",
    "/settings/members",
    "/settings/groups",
    "/settings/spaces",
    "/settings/sharing",
  ])("keeps non-configuration path %s visible to workspace members", (path) => {
    expect(canAccessSettingsPath(path, false)).toBe(true);
  });

  it("keeps AI and API keys active states mutually exclusive", () => {
    expect(isSettingsItemActive("/settings/ai", "/settings/ai")).toBe(true);
    expect(isSettingsItemActive("/settings/ai/spaces/demo", "/settings/ai")).toBe(
      true,
    );
    // Both tab routes must keep the sidebar item highlighted.
    expect(isSettingsItemActive("/settings/ai/spaces", "/settings/ai")).toBe(
      true,
    );
    expect(
      isSettingsItemActive("/settings/ai/external-tools", "/settings/ai"),
    ).toBe(true);
    expect(isSettingsItemActive("/settings/keys/mcp", "/settings/ai")).toBe(
      false,
    );
    expect(isSettingsItemActive("/settings/keys", "/settings/keys")).toBe(true);
    expect(isSettingsItemActive("/settings/keys/mcp", "/settings/keys")).toBe(
      true,
    );
    expect(isSettingsItemActive("/settings/keys/rag", "/settings/keys")).toBe(
      true,
    );
  });
});
