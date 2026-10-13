import { describe, expect, it } from "vitest";
import {
  formatDatabaseLocalTime,
  parseDatabaseLocalTime,
} from "./database-date";

describe("Database date time zones", () => {
  it("round-trips a local time independently of the browser time zone", () => {
    expect(parseDatabaseLocalTime("2026-10-13T10:00", "Europe/Moscow")).toBe(
      "2026-10-13T07:00:00.000Z",
    );
    expect(
      formatDatabaseLocalTime("2026-10-13T07:00:00.000Z", "Europe/Moscow"),
    ).toBe("2026-10-13T10:00");
  });
  it("rejects nonexistent daylight-saving local times", () => {
    expect(() =>
      parseDatabaseLocalTime("2026-03-29T02:30", "Europe/Berlin"),
    ).toThrow();
  });
});
