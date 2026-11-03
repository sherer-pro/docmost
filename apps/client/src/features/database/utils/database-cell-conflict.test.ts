import { describe, expect, it } from "vitest";
import type { IDatabaseProperty } from "../types/database.types";
import type { IDatabaseRowContext } from "../types/database-table.types";
import {
  buildDatabaseCellReview,
  isDatabaseCellConflict,
  type DatabaseCellConflict,
} from "./database-cell-conflict";

const databaseId = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";
const propertyId = "33333333-3333-4333-8333-333333333333";

function fixture() {
  const property: IDatabaseProperty = {
    id: propertyId,
    databaseId,
    workspaceId: "workspace",
    name: "Budget",
    type: "number",
    position: 0,
    settings: {},
    creatorId: null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
  const conflict: DatabaseCellConflict = {
    key: `${pageId}:${propertyId}`,
    row: { id: "row", pageId, pageTitle: "Current row" },
    property,
    originalValue: 12,
    draftValue: 19,
    session: 1,
  };
  const context: IDatabaseRowContext = {
    database: { id: databaseId, name: "Database" },
    row: { databaseId, pageId },
    properties: [property],
    cells: [{ id: "cell", pageId, propertyId, value: 15, revision: 4 }],
  };
  return {
    databaseId,
    conflict,
    context,
    properties: [property],
    page: {
      id: pageId,
      access: { capabilities: { canWrite: true as boolean | undefined } },
    },
  };
}

describe("isDatabaseCellConflict", () => {
  it("recognizes only an actual HTTP 409 response", () => {
    expect(isDatabaseCellConflict({ response: { status: 409 } })).toBe(true);
    for (const value of [
      null,
      undefined,
      "409",
      { status: 409 },
      { response: { status: "409" } },
      { response: { status: 403 } },
    ])
      expect(isDatabaseCellConflict(value)).toBe(false);
  });
});

describe("buildDatabaseCellReview", () => {
  it("uses current property metadata and revision while preserving the original and draft", () => {
    const input = fixture();
    input.properties = [
      {
        ...input.properties[0],
        name: "Renamed budget",
        settings: { format: "currency", currency: "USD" },
      },
    ];
    const result = buildDatabaseCellReview(input);
    expect(result).toMatchObject({
      property: { name: "Renamed budget" },
      value: 15,
      revision: 4,
      canWrite: true,
      row: { pageId, cells: input.context.cells, canWrite: true },
    });
    expect(input.conflict.originalValue).toBe(12);
    expect(input.conflict.draftValue).toBe(19);
    expect(input.conflict.property.name).toBe("Budget");
  });

  it("preserves a real zero, legacy containers and an empty cell at revision zero", () => {
    const input = fixture();
    input.context.cells[0] = {
      ...input.context.cells[0],
      revision: 0,
      value: { value: 0, rawValueBeforeTypeChange: "previous" },
    };
    expect(buildDatabaseCellReview(input)).toMatchObject({
      value: 0,
      revision: 0,
    });
    input.context.cells = [];
    const empty = buildDatabaseCellReview(input);
    expect(empty?.value).toBeUndefined();
    expect(empty?.revision).toBe(0);
    input.context.cells = [
      { id: "cell", pageId, propertyId, value: false, revision: 1 },
    ];
    expect(buildDatabaseCellReview(input)?.value).toBe(false);
  });

  it.each([false, undefined])(
    "requires an explicit current write capability instead of trusting the stale row (%s)",
    (canWrite) => {
      const input = fixture();
      input.conflict.row.canWrite = true;
      input.page.access.capabilities.canWrite = canWrite;
      expect(buildDatabaseCellReview(input)).toMatchObject({
        canWrite: false,
        row: { canWrite: false },
      });
    },
  );

  it.each([
    [
      "database identity",
      (input: ReturnType<typeof fixture>) => {
        input.context.database.id = "other";
      },
    ],
    [
      "row database identity",
      (input: ReturnType<typeof fixture>) => {
        input.context.row.databaseId = "other";
      },
    ],
    [
      "row page identity",
      (input: ReturnType<typeof fixture>) => {
        input.context.row.pageId = "other";
      },
    ],
    [
      "authorized page identity",
      (input: ReturnType<typeof fixture>) => {
        input.page.id = "other";
      },
    ],
    [
      "deleted property",
      (input: ReturnType<typeof fixture>) => {
        input.properties = [];
      },
    ],
    [
      "changed property type",
      (input: ReturnType<typeof fixture>) => {
        input.properties = [{ ...input.properties[0], type: "multiline_text" }];
      },
    ],
    [
      "property database identity",
      (input: ReturnType<typeof fixture>) => {
        input.properties = [{ ...input.properties[0], databaseId: "other" }];
      },
    ],
    [
      "soft-deleted property",
      (input: ReturnType<typeof fixture>) => {
        input.properties = [
          { ...input.properties[0], deletedAt: "2026-11-02T12:00:00Z" },
        ];
      },
    ],
    [
      "cell page identity",
      (input: ReturnType<typeof fixture>) => {
        input.context.cells[0].pageId = "other";
      },
    ],
  ] as const)("rejects contradictory or stale %s", (_name, change) => {
    const input = fixture();
    change(input);
    expect(buildDatabaseCellReview(input)).toBeNull();
  });

  it("does not create a review when the row is no longer available", () => {
    expect(buildDatabaseCellReview({ ...fixture(), context: null })).toBeNull();
  });
});
