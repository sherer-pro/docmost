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
    "/settings/ai/rag",
    "/settings/ai/mcp",
  ])("hides configuration path %s from workspace members", (path) => {
    expect(canAccessSettingsPath(path, false)).toBe(false);
    expect(canAccessSettingsPath(path, true)).toBe(true);
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

  it("keeps AI, RAG, and MCP active states mutually exclusive", () => {
    expect(isSettingsItemActive("/settings/ai", "/settings/ai")).toBe(true);
    expect(isSettingsItemActive("/settings/ai/spaces/demo", "/settings/ai")).toBe(
      true,
    );
    expect(isSettingsItemActive("/settings/ai/rag", "/settings/ai")).toBe(
      false,
    );
    expect(isSettingsItemActive("/settings/ai/mcp", "/settings/ai")).toBe(
      false,
    );
    expect(isSettingsItemActive("/settings/ai/rag", "/settings/ai/rag")).toBe(
      true,
    );
    expect(isSettingsItemActive("/settings/ai/mcp", "/settings/ai/mcp")).toBe(
      true,
    );
  });
});
