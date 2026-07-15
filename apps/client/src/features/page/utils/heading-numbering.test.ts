import { describe, expect, it } from "vitest";
import {
  getHeadingNumberingOverride,
  resolveHeadingNumberingEnabled,
} from "./heading-numbering";

describe("heading numbering settings", () => {
  it("defaults to disabled and inherits the space setting", () => {
    expect(resolveHeadingNumberingEnabled({})).toBe(false);
    expect(
      resolveHeadingNumberingEnabled({
        pageSettings: { headingNumbering: { enabled: null } },
        spaceSettings: { headingNumbering: { enabled: true } },
      }),
    ).toBe(true);
  });

  it("uses explicit page overrides", () => {
    expect(
      resolveHeadingNumberingEnabled({
        pageSettings: { headingNumbering: { enabled: false } },
        spaceSettings: { headingNumbering: { enabled: true } },
      }),
    ).toBe(false);
    expect(
      resolveHeadingNumberingEnabled({
        pageSettings: { headingNumbering: { enabled: true } },
      }),
    ).toBe(true);
  });

  it("maps storage values to the tri-state control", () => {
    expect(getHeadingNumberingOverride()).toBe("inherit");
    expect(
      getHeadingNumberingOverride({ headingNumbering: { enabled: null } }),
    ).toBe("inherit");
    expect(
      getHeadingNumberingOverride({ headingNumbering: { enabled: true } }),
    ).toBe("enabled");
    expect(
      getHeadingNumberingOverride({ headingNumbering: { enabled: false } }),
    ).toBe("disabled");
  });
});
