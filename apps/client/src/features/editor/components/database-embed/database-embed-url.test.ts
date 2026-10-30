import { describe, expect, it } from "vitest";
import { parseDatabaseEmbedUrl } from "./database-embed-url";

describe("internal database view links", () => {
  const origin = "https://wiki.example";
  it("accepts internal database links with a selected view", () => {
    expect(
      parseDatabaseEmbedUrl(
        `${origin}/s/team/db/tasks-abcdef?viewId=00000000-0000-4000-8000-000000000001`,
        origin,
      ),
    ).toEqual({
      pageSlug: "tasks-abcdef",
      viewId: "00000000-0000-4000-8000-000000000001",
    });
  });
  it.each([
    "https://evil.example/s/team/db/tasks",
    "javascript:alert(1)",
    "/s/team/p/tasks",
    "/s/team/db/tasks?viewId=not-an-id",
    "/s/team/db/%ZZ",
  ])("rejects %s", (value) =>
    expect(parseDatabaseEmbedUrl(value, origin)).toBeNull(),
  );
});
