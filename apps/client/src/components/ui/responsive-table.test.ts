import { describe, expect, it } from "vitest";
import {
  getResponsiveActionCellProps,
  getResponsiveMetaCellProps,
  getResponsivePrimaryCellProps,
} from "./responsive-table";

describe("responsive table card props", () => {
  it("marks primary and meta cells with card roles", () => {
    expect(getResponsivePrimaryCellProps("User")).toEqual({
      "data-label": "User",
      "data-card-role": "primary",
      className: undefined,
    });

    expect(getResponsiveMetaCellProps("Role")).toEqual({
      "data-label": "Role",
      "data-card-role": "meta",
      className: undefined,
    });
  });

  it("adds the shared action-cell class to action cells", () => {
    const props = getResponsiveActionCellProps();

    expect(props["data-label"]).toBe("");
    expect(props["data-card-role"]).toBe("actions");
    expect(props.className).toContain("actionCell");
  });
});
