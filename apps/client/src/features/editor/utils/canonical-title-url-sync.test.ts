import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { shouldSyncCanonicalUrlNow } from "./canonical-title-url-sync";

describe("canonical title url sync helper", () => {
  it("defers sync while user is editing title", () => {
    const result = shouldSyncCanonicalUrlNow(
      "/s/workspace/p/old-page-slug",
      "/s/workspace/p/new-page-slug",
      true,
    );

    assert.equal(result, false);
  });

  it("allows sync after title loses focus", () => {
    const result = shouldSyncCanonicalUrlNow(
      "/s/workspace/db/old-db-slug",
      "/s/workspace/db/new-db-slug",
      false,
    );

    assert.equal(result, true);
  });
});

