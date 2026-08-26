import {
  apiGet,
  apiPost,
  createAdminApi,
  createPage,
  loadAuditState,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { expect, mainEditor, test } from "../support/audit-test";

const content = {
  type: "doc",
  content: [
    {
      type: "table",
      attrs: { widthMode: "normal" },
      content: [row("A1", "B1", "C1"), row("A2", "B2", "C2")],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Outside selection anchor" }],
    },
  ],
};

function row(...values: string[]) {
  return {
    type: "tableRow",
    content: values.map((value) => ({
      type: "tableCell",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: value }],
        },
      ],
    })),
  };
}

async function settleLayout(page: import("@playwright/test").Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test("keeps table widths stable and reorders logical columns", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const auditPage = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} table layout and dnd`,
    content,
  );

  const setMode = async (mode: "read" | "edit") => {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [auditPage.id]: mode,
      },
    });
  };

  try {
    await setMode("edit");
    await page.goto(pageUrl(state, auditPage));
    const editor = mainEditor(page);
    const table = editor.locator("table").first();
    const firstCell = table.locator("tr").first().locator("td, th").first();
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(table.locator(":scope > colgroup > col")).toHaveCount(3);
    await settleLayout(page);

    const geometry = () =>
      table.evaluate((element) => ({
        tableWidth: element.getBoundingClientRect().width,
        columnWidths: Array.from(
          element.querySelectorAll(":scope > colgroup > col"),
          (column) => column.getBoundingClientRect().width,
        ),
        firstCellHeight: element
          .querySelector("td, th")!
          .getBoundingClientRect().height,
      }));

    const initial = await geometry();
    expect(
      Math.max(...initial.columnWidths) - Math.min(...initial.columnWidths),
    ).toBeLessThan(2);

    await firstCell.locator("p").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" short");
    await settleLayout(page);
    const afterShortInput = await geometry();
    expect(afterShortInput.columnWidths[0]).toBeCloseTo(
      initial.columnWidths[0],
      0,
    );

    await page.keyboard.type("W".repeat(45));
    await settleLayout(page);
    const afterLongInput = await geometry();
    expect(afterLongInput.columnWidths[0]).toBeGreaterThan(
      initial.columnWidths[0] + 20,
    );
    expect(afterLongInput.columnWidths[1]).toBeLessThan(
      initial.columnWidths[1] - 5,
    );
    expect(afterLongInput.tableWidth).toBeCloseTo(initial.tableWidth, 0);

    await page.keyboard.type("W".repeat(180));
    await settleLayout(page);
    const afterCappedInput = await geometry();
    expect(afterCappedInput.columnWidths[1]).toBeGreaterThanOrEqual(47);
    expect(afterCappedInput.columnWidths[2]).toBeGreaterThanOrEqual(47);
    expect(afterCappedInput.tableWidth).toBeCloseTo(initial.tableWidth, 0);
    expect(afterCappedInput.firstCellHeight).toBeGreaterThan(
      initial.firstCellHeight,
    );

    await page.keyboard.press("Control+a");
    await page.keyboard.type("A1");
    await settleLayout(page);
    const afterDeletion = await geometry();
    expect(
      Math.max(...afterDeletion.columnWidths) -
        Math.min(...afterDeletion.columnWidths),
    ).toBeLessThan(2);

    await firstCell.locator("p").click();
    const moveRight = page.getByRole("button", { name: "Move column right" });
    await expect(moveRight).toBeEnabled();
    await moveRight.focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        table.locator("tr").first().locator("td, th").allTextContents(),
      )
      .toEqual(["B1", "A1", "C1"]);

    await editor.getByText("Outside selection anchor", { exact: true }).click();
    const firstColumnCell = table
      .locator("tr")
      .first()
      .locator("td, th")
      .first();
    await firstColumnCell.hover();
    const columnHandle = page.locator(
      '.drag-handle[data-direction="horizontal"]',
    );
    await expect(columnHandle).toHaveAttribute("aria-label", "Move column");
    await expect(columnHandle).toBeVisible();
    await columnHandle.dragTo(
      table.locator("tr").first().locator("td, th").last(),
    );
    await expect
      .poll(() =>
        table.locator("tr").first().locator("td, th").allTextContents(),
      )
      .toEqual(["A1", "C1", "B1"]);

    await editor.click();
    await page.keyboard.press("Control+z");
    await expect
      .poll(() =>
        table.locator("tr").first().locator("td, th").allTextContents(),
      )
      .toEqual(["B1", "A1", "C1"]);
    await page.keyboard.press("Control+y");
    await expect
      .poll(() =>
        table.locator("tr").first().locator("td, th").allTextContents(),
      )
      .toEqual(["A1", "C1", "B1"]);

    await setMode("read");
    await page.reload();
    await expect(page.locator(".drag-handle")).toHaveCount(0);

    await setMode("edit");
    await page.setViewportSize({ width: 600, height: 900 });
    await page.reload();
    const narrowTableCell = mainEditor(page)
      .locator("table")
      .first()
      .locator("td, th")
      .first();
    await narrowTableCell.hover();
    await expect(
      page.locator('.drag-handle[data-direction="horizontal"]'),
    ).not.toBeVisible();
  } finally {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
