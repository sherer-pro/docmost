// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPageById } from "@/features/page/services/page-service";
import {
  getDatabaseProperties,
  getDatabaseRowContextByPage,
  batchUpdateDatabaseCells,
} from "../services/database-service";
import type { IDatabaseProperty } from "../types/database.types";
import type { IDatabaseRowContext } from "../types/database-table.types";
import type { DatabaseCellConflict } from "../utils/database-cell-conflict";
import { DatabaseCellConflictDialog } from "./database-cell-conflict-dialog";

vi.mock("react-i18next", async (original) => ({
  ...(await original<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en-US" },
  }),
}));
vi.mock("@/features/page/services/page-service", async (original) => ({
  ...(await original<typeof import("@/features/page/services/page-service")>()),
  getPageById: vi.fn(),
}));
vi.mock("../services/database-service", async (original) => ({
  ...(await original<typeof import("../services/database-service")>()),
  getDatabaseProperties: vi.fn(),
  getDatabaseRowContextByPage: vi.fn(),
  batchUpdateDatabaseCells: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const databaseId = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";
const property: IDatabaseProperty = {
  id: "33333333-3333-4333-8333-333333333333",
  databaseId,
  workspaceId: "workspace",
  name: "Budget",
  type: "number",
  position: 0,
  settings: { format: "currency", currency: "USD" },
  creatorId: null,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};
const makeConflict = (session = 1): DatabaseCellConflict => ({
  key: `${pageId}:${property.id}`,
  row: { id: "row", pageId, pageTitle: "Review row" },
  property,
  originalValue: 1000,
  draftValue: 1200.5,
  session,
});
const context = (value = 1100, revision = 4): IDatabaseRowContext => ({
  database: { id: databaseId, name: "Database" },
  row: { databaseId, pageId },
  properties: [property],
  cells: [{ id: "cell", pageId, propertyId: property.id, value, revision }],
});
const page = (canWrite = true) =>
  ({ id: pageId, access: { capabilities: { canWrite } } }) as Awaited<
    ReturnType<typeof getPageById>
  >;

describe("DatabaseCellConflictDialog", () => {
  let root: Root;
  let container: HTMLDivElement;
  let client: QueryClient;
  let onApply: ReturnType<typeof vi.fn>;
  let onUseCurrent: ReturnType<typeof vi.fn>;
  let onClose: ReturnType<typeof vi.fn>;
  let onReturnFocus: ReturnType<typeof vi.fn>;
  let conflict: DatabaseCellConflict;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    vi.mocked(getDatabaseProperties).mockReset().mockResolvedValue([property]);
    vi.mocked(getDatabaseRowContextByPage)
      .mockReset()
      .mockResolvedValue(context());
    vi.mocked(getPageById).mockReset().mockResolvedValue(page());
    vi.mocked(batchUpdateDatabaseCells).mockReset();
    conflict = makeConflict();
    onApply = vi.fn(async () => true);
    onUseCurrent = vi.fn();
    onClose = vi.fn();
    onReturnFocus = vi.fn();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  });
  const button = (key: string) => {
    const result = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((item) => item.textContent?.trim() === key);
    if (!result) throw new Error(`Missing button ${key}`);
    return result;
  };
  const click = async (key: string) => {
    await act(async () => button(key).click());
  };
  const render = async (value: DatabaseCellConflict | null = conflict) => {
    await act(async () => {
      root.render(
        <MantineProvider env="test">
          <QueryClientProvider client={client}>
            <DatabaseCellConflictDialog
              conflict={value}
              databaseId={databaseId}
              spaceId="space"
              onClose={onClose}
              onUseCurrent={onUseCurrent}
              onApply={onApply}
              onReturnFocus={onReturnFocus}
            />
          </QueryClientProvider>
        </MantineProvider>,
      );
    });
  };
  const assertNoAutomaticWrite = () => {
    expect(batchUpdateDatabaseCells).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(onUseCurrent).not.toHaveBeenCalled();
  };

  it("waits for all three authorized reads, renders typed separate versions, and writes only on an explicit apply", async () => {
    const rowRead = deferred<IDatabaseRowContext | null>();
    const propertyRead = deferred<IDatabaseProperty[]>();
    const pageRead = deferred<Awaited<ReturnType<typeof getPageById>>>();
    vi.mocked(getDatabaseRowContextByPage).mockReturnValueOnce(rowRead.promise);
    vi.mocked(getDatabaseProperties).mockReturnValueOnce(propertyRead.promise);
    vi.mocked(getPageById).mockReturnValueOnce(pageRead.promise);
    await render();
    expect(getDatabaseRowContextByPage).toHaveBeenCalledWith(pageId);
    expect(getDatabaseProperties).toHaveBeenCalledWith(databaseId);
    expect(getPageById).toHaveBeenCalledWith({ pageId });
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(true);
    expect(button("dbTable.cellConflictUseCurrent").disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "dbTable.cellConflictNotLoaded",
    );
    expect(document.body.textContent).toContain("$1,000.00");
    expect(document.body.textContent).toContain("$1,200.50");
    assertNoAutomaticWrite();
    await act(async () => {
      rowRead.resolve(context());
      propertyRead.resolve([property]);
    });
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(true);
    assertNoAutomaticWrite();
    await act(async () => pageRead.resolve(page()));
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(false);
    const rows = Array.from(
      document.querySelectorAll("tbody tr"),
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      "dbTable.cellConflictOriginal$1,000.00",
      "dbTable.cellConflictCurrent$1,100.00",
      "dbTable.cellConflictDraft$1,200.50",
    ]);
    expect(
      document.querySelectorAll(
        'input:not([disabled]), textarea, [role="combobox"]',
      ),
    ).toHaveLength(0);
    assertNoAutomaticWrite();
    await click("dbTable.cellConflictApplyDraft");
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(
      conflict,
      expect.objectContaining({ value: 1100, revision: 4, canWrite: true }),
    );
    expect(batchUpdateDatabaseCells).not.toHaveBeenCalled();
    expect(onUseCurrent).not.toHaveBeenCalled();
  });

  it("lets the user keep the server value without applying the draft", async () => {
    await render();
    assertNoAutomaticWrite();
    await click("dbTable.cellConflictUseCurrent");
    expect(onUseCurrent).toHaveBeenCalledWith(
      conflict,
      expect.objectContaining({ value: 1100, revision: 4 }),
    );
    expect(onApply).not.toHaveBeenCalled();
    expect(batchUpdateDatabaseCells).not.toHaveBeenCalled();
  });

  it("cancels without choosing or writing either value", async () => {
    await render();
    await click("Cancel");
    expect(onClose).toHaveBeenCalledOnce();
    assertNoAutomaticWrite();
    expect(conflict.originalValue).toBe(1000);
    expect(conflict.draftValue).toBe(1200.5);
    await render(null);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["forbidden", "deleted property", "changed property type"])(
    "fails closed for %s readback and permits a fresh explicit review",
    async (reason) => {
      if (reason === "forbidden")
        vi.mocked(getPageById).mockRejectedValueOnce({
          response: { status: 403 },
        });
      if (reason === "deleted property")
        vi.mocked(getDatabaseProperties).mockResolvedValueOnce([]);
      if (reason === "changed property type")
        vi.mocked(getDatabaseProperties).mockResolvedValueOnce([
          { ...property, type: "multiline_text" },
        ]);
      await render();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        "dbTable.cellConflictUnavailable",
      );
      expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(true);
      expect(button("dbTable.cellConflictUseCurrent").disabled).toBe(true);
      assertNoAutomaticWrite();
      await click("dbTable.cellConflictReload");
      expect(getPageById).toHaveBeenCalledTimes(2);
      expect(getDatabaseProperties).toHaveBeenCalledTimes(2);
      expect(getDatabaseRowContextByPage).toHaveBeenCalledTimes(2);
      expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(false);
      assertNoAutomaticWrite();
    },
  );

  it("keeps a read-only server value reviewable while forbidding a draft write", async () => {
    vi.mocked(getPageById).mockResolvedValueOnce(page(false));
    await render();
    expect(document.body.textContent).toContain("dbTable.cellConflictReadOnly");
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(true);
    expect(button("dbTable.cellConflictUseCurrent").disabled).toBe(false);
    await click("dbTable.cellConflictApplyDraft");
    assertNoAutomaticWrite();
  });

  it("prevents repeated apply while pending and requires a fresh review after an unsuccessful apply", async () => {
    const applying = deferred<boolean>();
    onApply.mockReturnValueOnce(applying.promise);
    await render();
    await click("dbTable.cellConflictApplyDraft");
    expect(onApply).toHaveBeenCalledOnce();
    expect(button("Cancel").disabled).toBe(true);
    expect(button("dbTable.cellConflictUseCurrent").disabled).toBe(true);
    expect(button("dbTable.cellConflictReload").disabled).toBe(true);
    await click("dbTable.cellConflictApplyDraft");
    expect(onApply).toHaveBeenCalledOnce();
    await act(async () => applying.resolve(false));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "dbTable.cellConflictUnavailable",
    );
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(true);
    expect(button("dbTable.cellConflictUseCurrent").disabled).toBe(true);
    expect(getDatabaseRowContextByPage).toHaveBeenCalledTimes(1);
    expect(batchUpdateDatabaseCells).not.toHaveBeenCalled();
    await click("dbTable.cellConflictReload");
    expect(getDatabaseRowContextByPage).toHaveBeenCalledTimes(2);
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(false);
    expect(onApply).toHaveBeenCalledOnce();
  });

  it("ignores a late response from an earlier conflict session", async () => {
    const earlier = deferred<IDatabaseRowContext | null>();
    vi.mocked(getDatabaseRowContextByPage)
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce(context(1400, 8));
    await render();
    const next = makeConflict(2);
    next.draftValue = 1600;
    await render(next);
    expect(document.body.textContent).toContain("$1,400.00");
    await act(async () => earlier.resolve(context(900, 2)));
    expect(document.body.textContent).not.toContain("$900.00");
    expect(document.body.textContent).toContain("$1,400.00");
    await click("dbTable.cellConflictApplyDraft");
    expect(onApply).toHaveBeenCalledWith(
      next,
      expect.objectContaining({ value: 1400, revision: 8 }),
    );
    expect(batchUpdateDatabaseCells).not.toHaveBeenCalled();
  });

  it("keeps the draft reviewable after the apply callback rejects", async () => {
    onApply.mockRejectedValueOnce({ response: { status: 403 } });
    await render();
    await click("dbTable.cellConflictApplyDraft");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "dbTable.cellConflictUnavailable",
    );
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(false);
    expect(document.body.textContent).toContain("$1,200.50");
    expect(getDatabaseRowContextByPage).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledOnce();
    expect(batchUpdateDatabaseCells).not.toHaveBeenCalled();
  });

  it("does not let a late failed apply replace the next session's current review", async () => {
    const applying = deferred<boolean>();
    onApply.mockReturnValueOnce(applying.promise);
    await render();
    await click("dbTable.cellConflictApplyDraft");
    vi.mocked(getDatabaseRowContextByPage).mockResolvedValueOnce(
      context(1400, 8),
    );
    const next = makeConflict(2);
    next.draftValue = 1600;
    await render(next);
    expect(document.body.textContent).toContain("$1,400.00");
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(false);
    await act(async () => applying.resolve(false));
    expect(document.body.textContent).toContain("$1,400.00");
    expect(button("dbTable.cellConflictApplyDraft").disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(onApply).toHaveBeenCalledOnce();
    expect(onUseCurrent).not.toHaveBeenCalled();
    expect(batchUpdateDatabaseCells).not.toHaveBeenCalled();
  });
});
