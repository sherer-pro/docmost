import { describe, expect, it } from "vitest";
import {
  DatabaseCellSaveCoordinator,
  getFailedDatabaseOperations,
  parseDatabaseTsv,
} from "./database-editing";
import {
  normalizeDatabaseValue,
  normalizeDatabaseViewState,
} from "@docmost/api-contract";

describe("Database data entry contracts", () => {
  it("preserves internal blank rows and empty cells in TSV", () => {
    expect(parseDatabaseTsv("a\tb\r\n\r\nx\t\r\n")).toEqual([
      ["a", "b"],
      [""],
      ["x", ""],
    ]);
  });
  it("retries only failed rows", () => {
    const operations = [{ pageId: "a" }, { pageId: "b" }];
    expect(getFailedDatabaseOperations(operations, ["b"])).toEqual([
      operations[1],
    ]);
  });
  it("coalesces duplicate saves and serializes different intentions", async () => {
    const coordinator = new DatabaseCellSaveCoordinator();
    const order: number[] = [];
    let finish!: () => void;
    const first = coordinator.save(
      "cell",
      async () => {
        order.push(1);
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        order.push(2);
        return 1;
      },
      "first",
    );
    const duplicate = coordinator.save(
      "cell",
      async () => {
        throw new Error("Duplicate must not run");
      },
      "first",
    );
    const second = coordinator.save(
      "cell",
      async () => {
        order.push(3);
        return 2;
      },
      "second",
    );
    expect(first).toBe(duplicate);
    finish();
    expect(await second).toBe(2);
    expect(order).toEqual([1, 2, 3]);
  });
  it("validates numbers, selections, protocols, and calendar dates", () => {
    expect(normalizeDatabaseValue("number", "10,25")).toBe(10.25);
    for (const value of ["0x10", "Infinity", {}, "invalid"])
      expect(() => normalizeDatabaseValue("number", value)).toThrow();
    expect(
      normalizeDatabaseValue("multi_select", ["b", "a", "b"], {
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      }),
    ).toEqual(["a", "b"]);
    expect(() =>
      normalizeDatabaseValue("url", "javascript:alert(1)"),
    ).toThrow();
    expect(() => normalizeDatabaseValue("date", "2026-02-31")).toThrow();
    expect(normalizeDatabaseValue("date", { start: "2026-10-13" })).toEqual({
      start: "2026-10-13",
    });
    expect(() =>
      normalizeDatabaseValue("date", {
        start: "2026-10-13",
        end: "2026-10-12",
      }),
    ).toThrow();
    expect(() =>
      normalizeDatabaseValue("date", { start: "2026-10-13T10:00:00Z" }),
    ).toThrow();
  });
  it("adapts legacy views and enforces bounded filter nesting", () => {
    expect(
      normalizeDatabaseViewState({
        filters: [{ propertyId: "a", operator: "contains", value: "x" }],
        sortState: { propertyId: "a", direction: "asc" },
      }).sorts,
    ).toEqual([{ propertyId: "a", direction: "asc" }]);
    expect(() =>
      normalizeDatabaseViewState({
        version: 2,
        filter: {
          conjunction: "and",
          conditions: [
            {
              conjunction: "or",
              conditions: [{ conjunction: "and", conditions: [] }],
            },
          ],
        },
      }),
    ).toThrow();
  });
});
