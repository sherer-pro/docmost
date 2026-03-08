import { describe, expect, it, vi } from "vitest";
import {
  formatHistoryEventDetails,
  formatHistorySummary,
} from "./history-summary";
import { IPageHistory } from "@/features/page-history/types/page.types";

function createHistoryItem(overrides: Partial<IPageHistory>): IPageHistory {
  return {
    id: "history-1",
    pageId: "page-1",
    title: "Title",
    slug: null,
    icon: null,
    coverPhoto: null,
    version: null,
    lastUpdatedById: "user-1",
    workspaceId: "ws-1",
    createdAt: "2026-03-08T00:00:00.000Z",
    updatedAt: "2026-03-08T00:00:00.000Z",
    lastUpdatedBy: {
      id: "user-1",
      name: "User",
      avatarUrl: null,
    },
    ...overrides,
  } as IPageHistory;
}

describe("history summary/details formatter", () => {
  it("formats custom field details with translated history keys", () => {
    const t = vi.fn((key: string, options?: Record<string, unknown>) =>
      `${key}${options ? ` ${JSON.stringify(options)}` : ""}`,
    );

    const details = formatHistoryEventDetails(
      createHistoryItem({
        changeType: "page.custom-fields.updated",
        changeData: {
          changes: [{ field: "assigneeId", oldValue: null, newValue: { id: "u-2", name: "Jane" } }],
        },
      }),
      t,
    );

    expect(details[0].lines[0]).toContain("Jane");
    expect(t).toHaveBeenCalledWith(
      "history.event.field.changed",
      expect.objectContaining({ keySeparator: false }),
    );
  });

  it("formats combined events into structured detail entries", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}${options ? ` ${JSON.stringify(options)}` : ""}`;

    const details = formatHistoryEventDetails(
      createHistoryItem({
        changeType: "page.events.combined",
        changeData: {
          events: [
            {
              changeType: "database.property.created",
              changeData: { property: { name: "Status" } },
            },
            {
              changeType: "database.row.created",
              changeData: { row: { title: "Untitled row" } },
            },
          ],
        },
      }),
      t,
    );

    expect(details).toHaveLength(2);
    expect(details[0].title).toContain("history.event.database.property.created");
    expect(details[1].title).toContain("history.event.database.row.created");
  });

  it("returns combined summary with number of merged events", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}${options ? ` ${JSON.stringify(options)}` : ""}`;

    const summary = formatHistorySummary(
      createHistoryItem({
        changeType: "page.events.combined",
        changeData: {
          events: [{ changeType: "database.row.created", changeData: {} }],
        },
      }),
      t,
    );

    expect(summary).toContain("history.event.combined");
    expect(summary).toContain('"count":1');
  });

  it("formats database row renamed event with slug and title changes", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}${options ? ` ${JSON.stringify(options)}` : ""}`;

    const details = formatHistoryEventDetails(
      createHistoryItem({
        changeType: "database.row.renamed",
        changeData: {
          row: { title: "Renamed row" },
          changes: [
            { field: "title", oldValue: "Old row", newValue: "Renamed row" },
            { field: "slugId", oldValue: "old-slug", newValue: "new-slug" },
          ],
        },
      }),
      t,
    );

    expect(details[0].title).toContain("history.event.database.row.renamed");
    expect(details[0].lines[1]).toContain("history.event.field.slug");
  });

  it("returns structured rows for event-details table", () => {
    const t = (key: string, options?: Record<string, unknown>) =>
      `${key}${options ? ` ${JSON.stringify(options)}` : ""}`;

    const details = formatHistoryEventDetails(
      createHistoryItem({
        changeType: "database.row.cells.updated",
        changeData: {
          changes: [
            {
              propertyName: "User",
              propertyType: "user",
              oldValue: null,
              newValue: { id: "u-1", name: "Pavel" },
            },
            {
              propertyName: "Select",
              propertyType: "select",
              oldValue: '"metka-2-r311"',
              newValue: { value: "metka-4-2ejm", label: "Label 4" },
            },
          ],
        },
      }),
      t,
    );

    expect(details[0].rows).toHaveLength(2);
    expect(details[0].rows[0].newValue).toBe("Pavel");
    expect(details[0].rows[1].oldValue).toBe("metka-2-r311");
    expect(details[0].rows[1].newValue).toBe("Label 4");
  });
});
