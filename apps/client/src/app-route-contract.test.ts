import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src", "App.tsx"), "utf8");

describe("application route contract", () => {
  it("keeps canonical page and database routes", () => {
    expect(appSource).toContain('path={"/s/:spaceSlug/p/:pageSlug"}');
    expect(appSource).toContain('path={"/s/:spaceSlug/db/:databaseSlug"}');
  });

  it("does not register removed internal legacy routes", () => {
    expect(appSource).not.toContain('path={"/p/:pageSlug"}');
    expect(appSource).not.toContain(
      'path={"/s/:spaceSlug/databases/:databaseId"}',
    );
  });

  it("keeps public share routes separate from internal route removal", () => {
    expect(appSource).toContain('path={"/share/:shareId/p/:pageSlug"}');
    expect(appSource).toContain('path={"/share/p/:pageSlug"}');
  });
});
