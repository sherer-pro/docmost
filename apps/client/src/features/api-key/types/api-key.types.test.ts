import { describe, expect, expectTypeOf, it } from "vitest";
import type { IApiKey, ICreatedApiKey } from "./api-key.types";

describe("API key response types", () => {
  it("keeps the one-time token out of list and update metadata", () => {
    expectTypeOf<IApiKey>().not.toHaveProperty("token");
    expectTypeOf<ICreatedApiKey>().toHaveProperty("token").toEqualTypeOf<string>();

    const metadataKeys = [
      "id",
      "name",
      "creatorId",
      "workspaceId",
      "spaceId",
      "keyType",
      "expiresAt",
      "lastUsedAt",
      "createdAt",
      "allowedCapabilities",
      "creator",
    ];
    expect(metadataKeys).not.toContain("token");
  });
});
