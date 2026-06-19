import { describe, expect, it, vi } from "vitest";
import { getDictionaryImportSuccessMessage } from "./dictionary-import-notification";

describe("getDictionaryImportSuccessMessage", () => {
  it("passes imported and updated counts to the translation", () => {
    const t = vi.fn((key: string) => key);

    expect(
      getDictionaryImportSuccessMessage(t, {
        created: 4,
        updated: 2,
      }),
    ).toBe("Imported {{imported}} terms, updated {{updated}} terms");
    expect(t).toHaveBeenCalledWith(
      "Imported {{imported}} terms, updated {{updated}} terms",
      {
        imported: 4,
        updated: 2,
      },
    );
  });
});
