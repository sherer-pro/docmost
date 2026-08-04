import { describe, expect, it } from "vitest";
import type { AiBuiltinToolSpacePolicyView } from "@docmost/api-contract";
import {
  getAvailableMcpCapabilities,
  getMcpCapabilityPolicyState,
  getUnavailableMcpCapabilities,
  initializeMcpCapabilitySelection,
} from "./mcp-capability-policy.ts";

const policy = {
  spaceId: "space-1",
  effectiveCapabilities: ["page.content.read", "page.text.propose"],
  catalog: [
    {
      name: "getPage",
      capability: "page.content.read",
      exposures: ["agent", "mcp"],
    },
    {
      name: "editPageText",
      capability: "page.text.propose",
      exposures: ["agent"],
    },
  ],
} as AiBuiltinToolSpacePolicyView;

describe("MCP capability policy state", () => {
  it("distinguishes loading, error, empty, and ready states", () => {
    expect(
      getMcpCapabilityPolicyState({
        policy: undefined,
        loading: true,
        error: false,
      }),
    ).toBe("loading");
    expect(
      getMcpCapabilityPolicyState({
        policy: undefined,
        loading: false,
        error: true,
      }),
    ).toBe("error");
    expect(
      getMcpCapabilityPolicyState({
        policy: { ...policy, effectiveCapabilities: [] },
        loading: false,
        error: false,
      }),
    ).toBe("empty");
    expect(
      getMcpCapabilityPolicyState({
        policy,
        loading: false,
        error: false,
      }),
    ).toBe("ready");
  });

  it("offers only MCP reads and reports revoked selections", () => {
    expect(getAvailableMcpCapabilities(policy)).toEqual(["page.content.read"]);
    expect(
      getUnavailableMcpCapabilities(
        ["page.content.read", "page.comments.read"],
        policy,
      ),
    ).toEqual(["page.comments.read"]);
  });

  it("initializes each space once and preserves manual choices on refetch", () => {
    const selections = new Map();
    expect(
      initializeMcpCapabilitySelection(selections, "space-1", [
        "page.content.read",
      ]),
    ).toEqual(["page.content.read"]);
    selections.set("space-1", []);
    expect(
      initializeMcpCapabilitySelection(selections, "space-1", [
        "page.content.read",
        "page.comments.read",
      ]),
    ).toEqual([]);
  });
});
