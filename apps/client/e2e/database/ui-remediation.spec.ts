import { expect, test, type Page, type Request } from "@playwright/test";
import catalog from "../../public/locales/en-US/translation.json";

const databaseId = "10000000-0000-4000-8000-000000000001";
const notesId = "50000000-0000-4000-8000-000000000001";
const rowId = (index: number) =>
  `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const fixtureUrl = "/e2e/database/fixture.html";
const cellsPath = (index = 0) =>
  `/api/databases/${databaseId}/rows/${rowId(index)}/cells`;
const cell = (page: Page, index = 0) =>
  page.locator(`[data-database-cell-key="${rowId(index)}:${notesId}"]`);
const text = (key: string) =>
  key.split(".").reduce((value: any, segment) => value?.[segment], catalog) ??
  key;
const conflictDialog = (page: Page) =>
  page.getByRole("dialog", {
    name: text("dbTable.cellConflictTitle"),
    exact: true,
  });
const action = (page: Page, key: string) =>
  conflictDialog(page).getByRole("button", {
    name: text(`dbTable.${key}`),
    exact: true,
  });
async function state(page: Page) {
  return (await (await page.request.get("/api/fixture/state")).json()).data;
}
async function serverValue(
  page: Page,
  value: string,
  revision: number,
  index = 0,
) {
  const response = await page.request.patch(cellsPath(index), {
    data: {
      cells: [
        {
          propertyId: notesId,
          value,
          expectedRevision: revision,
          operation: "upsert",
        },
      ],
    },
  });
  expect(response.status()).toBe(200);
}
function captureWrites(page: Page) {
  const writes: any[] = [];
  page.on("request", (request: Request) => {
    if (
      request.method() === "PATCH" &&
      new URL(request.url()).pathname.endsWith("/cells")
    )
      writes.push(request.postDataJSON());
  });
  return writes;
}
async function startConflict(page: Page, draft = "My preserved draft") {
  await page.goto(fixtureUrl);
  await expect(page.getByText("Rows: 1000", { exact: true })).toBeVisible();
  await expect(cell(page)).toContainText("Value 0");
  await serverValue(page, "Current server value", 1);
  const writes = captureWrites(page);
  await cell(page).press("F2");
  await cell(page).getByRole("textbox").fill(draft);
  await cell(page).getByRole("textbox").press("Tab");
  await expect(
    page.getByRole("button", {
      name: text("dbTable.cellConflictReview"),
      exact: true,
    }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].cells[0].expectedRevision).toBe(1);
  return writes;
}
async function openReview(page: Page) {
  await page
    .getByRole("button", {
      name: text("dbTable.cellConflictReview"),
      exact: true,
    })
    .click();
  await expect(conflictDialog(page)).toBeVisible();
}

test.describe("UI remediation", () => {
  let errors: string[];
  test.beforeEach(async ({ page, request }) => {
    errors = [];
    await request.post("/api/fixture/reset");
    page.on("pageerror", (error) => errors.push(error.message));
  });
  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test("F020 reviews fresh values and keeps the server value without an automatic write", async ({
    page,
  }, info) => {
    const writes = await startConflict(page);
    await openReview(page);
    await expect(action(page, "cellConflictUseCurrent")).toBeEnabled();
    await expect(conflictDialog(page)).toContainText("Value 0");
    await expect(conflictDialog(page)).toContainText("Current server value");
    await expect(conflictDialog(page)).toContainText("My preserved draft");
    expect(writes).toHaveLength(1);
    const reads = (await state(page)).requests;
    expect(
      reads.some(
        (request) =>
          request.method === "GET" &&
          request.path === `/databases/rows/${rowId(0)}/context`,
      ),
    ).toBe(true);
    expect(
      reads.some(
        (request) =>
          request.method === "GET" &&
          request.path === "/pages/info" &&
          request.query.pageId === rowId(0),
      ),
    ).toBe(true);
    expect(
      reads.filter(
        (request) =>
          request.method === "GET" && request.path.endsWith("/properties"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
    await page.screenshot({
      path: info.outputPath("cell-conflict-review.png"),
    });
    await action(page, "cellConflictUseCurrent").click();
    await expect(conflictDialog(page)).toHaveCount(0);
    await expect(cell(page)).toContainText("Current server value");
    expect(writes).toHaveLength(1);
    const current = (await state(page)).rows[0].cells[0];
    expect(current.value).toBe("Current server value");
    expect(current.revision).toBe(2);
  });

  test("F020 applies the draft only after review with the freshly read revision", async ({
    page,
  }) => {
    const writes = await startConflict(page);
    await openReview(page);
    await expect(action(page, "cellConflictApplyDraft")).toBeEnabled();
    expect(writes).toHaveLength(1);
    await action(page, "cellConflictApplyDraft").click();
    await expect(conflictDialog(page)).toHaveCount(0);
    await expect
      .poll(async () => (await state(page)).rows[0].cells[0].value)
      .toBe("My preserved draft");
    expect(writes).toHaveLength(2);
    expect(writes[1].cells[0]).toMatchObject({
      propertyId: notesId,
      value: "My preserved draft",
      expectedRevision: 2,
    });
    expect((await state(page)).rows[0].cells[0].revision).toBe(3);
  });

  test("F020 a second 409 preserves the draft and requires another explicit recovery decision", async ({
    page,
  }) => {
    const writes = await startConflict(page);
    await openReview(page);
    await expect(action(page, "cellConflictApplyDraft")).toBeEnabled();
    await serverValue(page, "Server changed again", 2);
    await action(page, "cellConflictApplyDraft").click();
    await expect(conflictDialog(page)).toContainText("Server changed again");
    await expect(conflictDialog(page)).toContainText("My preserved draft");
    await expect(action(page, "cellConflictApplyDraft")).toBeEnabled();
    expect(writes).toHaveLength(2);
    expect(writes[1].cells[0].expectedRevision).toBe(2);
    expect((await state(page)).rows[0].cells[0].value).toBe(
      "Server changed again",
    );
    await conflictDialog(page)
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(conflictDialog(page)).toHaveCount(0);
    await openReview(page);
    await expect(conflictDialog(page)).toContainText("My preserved draft");
    await action(page, "cellConflictUseCurrent").click();
    await expect(conflictDialog(page)).toHaveCount(0);
    expect(writes).toHaveLength(2);
  });

  for (const failure of ["403", "deleted property"])
    test(`F020 ${failure} cannot apply a draft and cancel preserves it`, async ({
      page,
    }) => {
      const writes = await startConflict(page);
      const pattern =
        failure === "403"
          ? "**/api/pages/info?*"
          : `**/api/databases/${databaseId}/properties`;
      await page.route(pattern, (route) =>
        route.fulfill({
          status: failure === "403" ? 403 : 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: failure === "403" ? {} : [],
            success: failure !== "403",
          }),
        }),
      );
      await openReview(page);
      await expect(conflictDialog(page).getByRole("alert")).toContainText(
        text("dbTable.cellConflictUnavailable"),
      );
      await expect(action(page, "cellConflictApplyDraft")).toBeDisabled();
      expect(writes).toHaveLength(1);
      await conflictDialog(page)
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(conflictDialog(page)).toHaveCount(0);
      expect((await state(page)).rows[0].cells[0].value).toBe(
        "Current server value",
      );
      await page.unroute(pattern);
      await openReview(page);
      await expect(conflictDialog(page)).toContainText("My preserved draft");
      await expect(action(page, "cellConflictApplyDraft")).toBeEnabled();
      expect(writes).toHaveLength(1);
    });

  test("F020 a delayed 409 cannot steal focus or replace a different cell's draft", async ({
    page,
  }) => {
    await page.goto(fixtureUrl);
    await expect(cell(page)).toBeVisible();
    await serverValue(page, "Current server value", 1);
    let release!: () => void;
    let received!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const responseReceived = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route(
      `**${cellsPath()}`,
      async (route) => {
        const response = await route.fetch();
        received();
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    const writes = captureWrites(page);
    await cell(page).press("F2");
    await cell(page).getByRole("textbox").fill("Delayed original draft");
    await cell(page).getByRole("textbox").press("Tab");
    await responseReceived;
    const otherEditor = cell(page, 1).getByRole("textbox");
    try {
      await cell(page, 1).press("F2");
      await otherEditor.fill("Keep focus and this draft");
      await expect(otherEditor).toBeFocused();
    } finally {
      release();
    }
    await expect(
      page.getByRole("button", {
        name: text("dbTable.cellConflictReview"),
        exact: true,
      }),
    ).toBeVisible();
    await expect(otherEditor).toBeFocused();
    await expect(otherEditor).toHaveValue("Keep focus and this draft");
    await expect(conflictDialog(page)).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect((await state(page)).rows[1].cells[0].value).toBe("Value 1");
  });

  test("F017 creating an empty row refreshes the visible count and an inactive view's cached summary", async ({
    page,
    request,
  }, info) => {
    await request.post("/api/fixture/reset", {
      data: {
        rowCount: 0,
        views: [
          { name: "All records", config: {} },
          {
            name: "Needle records",
            config: {
              filter: {
                conjunction: "and",
                conditions: [
                  {
                    propertyId: notesId,
                    operator: "contains",
                    value: "needle",
                  },
                ],
              },
            },
          },
        ],
      },
    });
    await page.goto(fixtureUrl);
    await expect(page.getByText("Rows: 0", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "View", exact: true }).click();
    await page
      .getByRole("option", { name: "All records", exact: true })
      .click();
    await expect(page.getByText("Rows: 0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Row", exact: true }).click();
    await expect(page.getByText("Rows: 1", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "View", exact: true }).click();
    await page
      .getByRole("option", { name: "Needle records", exact: true })
      .click();
    await expect(page.getByText("Rows: 0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Row", exact: true }).click();
    await expect.poll(async () => (await state(page)).rows.length).toBe(2);
    await expect(page.getByText("Rows: 0", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("textbox", { name: "View", exact: true }).click();
    await page
      .getByRole("option", { name: "All records", exact: true })
      .click();
    await expect(page.getByText("Rows: 2", { exact: true })).toBeVisible();
    const requests = (await state(page)).requests;
    expect(
      requests.filter(
        (item) => item.method === "POST" && item.path.endsWith("/rows"),
      ),
    ).toHaveLength(2);
    expect(
      requests.filter(
        (item) =>
          item.path.endsWith("/summary") &&
          !JSON.parse(item.query.viewState).filter,
      ).length,
    ).toBeGreaterThanOrEqual(3);
    await page.screenshot({
      path: info.outputPath("created-count-two-views.png"),
    });
  });

  for (const [theme, width] of [
    ["light", 390],
    ["dark", 1440],
  ] as const)
    test(`F004 explicit property rename preserves width and never commits on blur ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${fixtureUrl}?theme=${theme}`);
      const header = page.locator(`th[data-database-property-id="${notesId}"]`);
      await expect(header.getByText("Notes", { exact: true })).toBeVisible();
      await expect(header.getByRole("textbox")).toHaveCount(0);
      const trigger = header.getByRole("button", {
        name: "Property actions",
        exact: true,
      });
      await trigger.click();
      await page
        .getByLabel(text("dbBoard.columnWidth"), { exact: true })
        .fill("170");
      await page.keyboard.press("Escape");
      await expect(header).toHaveCSS("min-width", "170px");
      const originalWidth = (await header.boundingBox())!.width;
      const openRename = async () => {
        await trigger.focus();
        await trigger.press("Enter");
        await page
          .getByRole("menuitem", { name: "Rename", exact: true })
          .press("Enter");
        await expect(
          page.getByRole("dialog", { name: "Rename", exact: true }),
        ).toBeVisible();
      };
      await openRename();
      const dialog = page.getByRole("dialog", { name: "Rename", exact: true });
      const input = dialog.getByRole("textbox", {
        name: "Property name",
        exact: true,
      });
      await expect(input).toBeFocused();
      await input.fill("Uncommitted on blur");
      await dialog.getByRole("button", { name: "Save", exact: true }).focus();
      expect((await state(page)).properties[0].name).toBe("Notes");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(header.getByText("Notes", { exact: true })).toBeVisible();
      await openRename();
      await expect(input).toHaveValue("Notes");
      await input.fill("Renamed notes");
      await input.press("Enter");
      await expect(dialog).toHaveCount(0);
      await expect(
        header.getByText("Renamed notes", { exact: true }),
      ).toBeVisible();
      expect((await state(page)).properties[0].name).toBe("Renamed notes");
      const updates = (await state(page)).requests.filter(
        (item) =>
          item.method === "PATCH" &&
          item.path.endsWith(`/properties/${notesId}`),
      );
      expect(updates).toHaveLength(1);
      expect(updates[0].body).toEqual({
        name: "Renamed notes",
        contractVersion: 4,
      });
      await expect(cell(page)).toContainText("Value 0");
      expect(
        Math.abs((await header.boundingBox())!.width - originalWidth),
      ).toBeLessThanOrEqual(1);
      await page.reload();
      await expect(
        header.getByText("Renamed notes", { exact: true }),
      ).toBeVisible();
      expect(
        Math.abs((await header.boundingBox())!.width - originalWidth),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: info.outputPath(`property-rename-${theme}-${width}.png`),
      });
    });
});
