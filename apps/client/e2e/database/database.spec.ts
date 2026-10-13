import { expect, test, type Page } from "@playwright/test";

const notesId = "50000000-0000-4000-8000-000000000001";
const rowId = (index: number) =>
  `60000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
const fixtureUrl = "/e2e/database/fixture.html";
async function state(page: Page) {
  return (await (await page.request.get("/api/fixture/state")).json()).data;
}
test.beforeEach(async ({ request }) => {
  await request.post("/api/fixture/reset");
});

for (const theme of ["light", "dark"])
  for (const width of [320, 390, 768, 1440]) {
    test(`responsive database ${theme} ${width}`, async ({
      page,
    }, testInfo) => {
      const failures: string[] = [];
      page.on("pageerror", (error) => failures.push(error.message));
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${fixtureUrl}?theme=${theme}`);
      await expect(page.getByText("Rows: 1000", { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: /^View settings/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Add sort", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Sort property 1" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(failures).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`database-${theme}-${width}.png`),
      });
    });
  }

test("editing preserves loaded pages and scroll and sends one save", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state(page)).requests.filter((request) =>
          request.path.endsWith("/rows"),
        ).length,
    )
    .toBeGreaterThanOrEqual(2);
  const viewport = page.locator(".mantine-ScrollArea-viewport").first();
  await viewport.evaluate((element) => {
    element.scrollTop = 2400;
  });
  await expect
    .poll(async () =>
      page
        .locator(`[data-database-cell-key$=":${notesId}"]`)
        .first()
        .getAttribute("data-database-cell-key"),
    )
    .not.toBe(`${rowId(0)}:${notesId}`);
  const key = await page
    .locator(`[data-database-cell-key$=":${notesId}"]`)
    .first()
    .getAttribute("data-database-cell-key");
  const cell = page.locator(`[data-database-cell-key="${key}"]`);
  await cell.press("F2");
  const editor = cell.getByRole("textbox");
  await editor.fill("Saved without jumping");
  const before = await viewport.evaluate((element) => element.scrollTop);
  await editor.press("Tab");
  await expect
    .poll(
      async () =>
        (await state(page)).requests.filter(
          (request) =>
            request.method === "PATCH" && request.path.endsWith("/cells"),
        ).length,
    )
    .toBe(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(
    await viewport.evaluate((element) => element.scrollTop),
  ).toBeGreaterThanOrEqual(before - 100);
  await expect(
    page.getByRole("button", { name: "Load more", exact: true }),
  ).toBeVisible();
});

test("TSV preserves blank rows and retries only failed operations", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  await expect(page.getByText("Rows: 1000", { exact: true })).toBeVisible();
  await page.request.post("/api/fixture/fail", { data: { rows: [rowId(2)] } });
  const cell = page.locator(
    `[data-database-cell-key="${rowId(0)}:${notesId}"]`,
  );
  await cell.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData("text", "first\n\nthird");
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(
    page.getByText("1 rows failed. Successful rows were saved."),
  ).toBeVisible();
  const initial = await state(page);
  expect(initial.rows[0].cells[0].value).toBe("first");
  expect(initial.rows[1].cells[0].value).toBeNull();
  expect(initial.rows[2].cells[0].value).toBe("Value 2");
  await page.request.post("/api/fixture/fail", { data: { rows: [] } });
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect
    .poll(async () => (await state(page)).rows[2].cells[0].value)
    .toBe("third");
  const requests = (await state(page)).requests.filter((request) =>
    request.path.endsWith("/rows/batch"),
  );
  expect(requests.at(-1).body.rows.map((row) => row.pageId)).toEqual([
    rowId(2),
  ]);
});

test("autosave preserves the second client draft on conflict", async ({
  context,
  page,
}) => {
  const other = await context.newPage();
  for (const target of [page, other]) {
    await target.goto(fixtureUrl);
    await target.getByRole("textbox", { name: "View", exact: true }).click();
    await target
      .getByRole("option", { name: "Shared view", exact: true })
      .click();
    await expect(
      target.getByRole("textbox", { name: "Name", exact: true }),
    ).toHaveValue("Shared view");
  }
  expect(
    (await state(page)).requests.filter(
      (request) =>
        request.method === "PATCH" && request.path.includes("/views/"),
    ),
  ).toHaveLength(0);
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("First client");
  await expect
    .poll(async () => (await state(page)).views[0].name)
    .toBe("First client");
  await other
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Second client");
  await expect(
    other.getByText(
      "This view changed in another session. Your draft is preserved.",
    ),
  ).toBeVisible();
  await expect(
    other.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue("Second client");
  await other
    .getByRole("button", { name: "Apply my changes", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).views[0].name)
    .toBe("Second client");
  await other.close();
});

test("reader has no mutation controls and can use view settings", async ({
  page,
}) => {
  await page.goto(`${fixtureUrl}?role=reader&locale=ru-RU`);
  await expect(page.getByText("Строки: 1000", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Название нового столбца" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Настройки представления/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (await state(page)).requests.every((request) => request.method === "GET"),
  ).toBe(true);
});

test("mixed row permissions keep denied edits unavailable", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const cell = page.locator(
    `[data-database-cell-key="${rowId(5)}:${notesId}"]`,
  );
  await expect(cell).toBeVisible();
  await cell.press("F2");
  await expect(cell.getByRole("textbox")).toHaveCount(0);
  await expect(
    cell.locator("xpath=..").getByRole("checkbox", { name: "Select row" }),
  ).toBeDisabled();
  expect(
    (await state(page)).requests.filter(
      (request) =>
        request.method === "PATCH" && request.path.endsWith("/cells"),
    ),
  ).toEqual([]);
  await cell
    .locator("xpath=..")
    .getByRole("button", { name: "Row actions" })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Rename row", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Delete row", exact: true }),
  ).toHaveCount(0);
});

test("select keyboard choice is saved once", async ({ page }) => {
  await page.goto(fixtureUrl);
  const cell = page.locator(
    `[data-database-cell-key="${rowId(0)}:50000000-0000-4000-8000-000000000009"]`,
  );
  await cell.press("F2");
  await cell.getByRole("textbox").click();
  await cell.getByRole("textbox").press("ArrowDown");
  await cell.getByRole("textbox").press("Enter");
  await expect
    .poll(
      async () =>
        (await state(page)).requests.filter(
          (request) =>
            request.method === "PATCH" && request.path.endsWith("/cells"),
        ).length,
    )
    .toBe(1);
});

test("date range time zone and decimal values save canonically", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const amount = page.locator(
    `[data-database-cell-key="${rowId(0)}:50000000-0000-4000-8000-000000000002"]`,
  );
  await amount.press("F2");
  await amount.getByRole("textbox").fill("10.25");
  await amount.getByRole("textbox").press("Enter");
  await expect
    .poll(async () => (await state(page)).rows[0].cells[1].value)
    .toBe(10.25);
  const date = page.locator(
    `[data-database-cell-key="${rowId(0)}:50000000-0000-4000-8000-000000000003"]`,
  );
  await date.press("F2");
  await date.getByRole("switch", { name: "Date range" }).check();
  await date.getByLabel("Date: Row 0: End", { exact: true }).fill("2026-10-14");
  await date.getByRole("switch", { name: "Include time" }).check();
  await date.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => (await state(page)).rows[0].cells[2].value)
    .toEqual({
      start: "2026-10-12T21:00:00.000Z",
      end: "2026-10-13T21:00:00.000Z",
      timeZone: "Europe/Moscow",
    });
  await date.press("F2");
  await date.getByRole("switch", { name: "Include time" }).uncheck();
  await date.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => (await state(page)).rows[0].cells[2].value)
    .toEqual({ start: "2026-10-13", end: "2026-10-14" });
});

test("failed cell save preserves the draft and can be retried", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const cell = page.locator(
    `[data-database-cell-key="${rowId(0)}:${notesId}"]`,
  );
  await cell.press("F2");
  const editor = cell.getByRole("textbox");
  await editor.fill("Preserved after network failure");
  await page.route(
    "**/cells",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: "{}",
      }),
    { times: 1 },
  );
  await editor.press("Tab");
  await expect(
    page.getByRole("status").filter({ hasText: "Failed to update data" }),
  ).toBeVisible();
  await expect(editor).toHaveValue("Preserved after network failure");
  await editor.press("Tab");
  await expect
    .poll(async () => (await state(page)).rows[0].cells[0].value)
    .toBe("Preserved after network failure");
});

test("an old cell response keeps a newer editor open", async ({ page }) => {
  await page.goto(fixtureUrl);
  const first = page.locator(
    `[data-database-cell-key="${rowId(0)}:${notesId}"]`,
  );
  const second = page.locator(
    `[data-database-cell-key="${rowId(1)}:${notesId}"]`,
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/cells",
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  await first.press("F2");
  await first.getByRole("textbox").fill("First intention");
  await first.getByRole("textbox").press("Tab");
  await second.press("F2");
  await second.getByRole("textbox").fill("Second draft");
  release();
  await expect
    .poll(async () => (await state(page)).rows[0].cells[0].value)
    .toBe("First intention");
  await expect(second.getByRole("textbox")).toHaveValue("Second draft");
  await second.getByRole("textbox").press("Escape");
});

for (const undo of [true, false])
  test(`deletion after unmount retains six seconds and ${undo ? "undo" : "original target"}`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto(fixtureUrl);
    const cell = page.locator(
      `[data-database-cell-key="${rowId(0)}:${notesId}"]`,
    );
    await cell
      .locator("xpath=..")
      .getByRole("checkbox", { name: "Select row", exact: true })
      .check();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete", exact: true })
      .click();
    await page.clock.runFor(300);
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Toggle database", exact: true })
      .click();
    await page.clock.fastForward(4500);
    expect(
      (await state(page)).requests.filter((request) =>
        request.path.endsWith("/rows/batch"),
      ),
    ).toEqual([]);
    if (undo)
      await page.getByRole("button", { name: "Undo", exact: true }).click();
    await page.clock.fastForward(2000);
    if (undo) {
      expect(
        (await state(page)).requests.filter((request) =>
          request.path.endsWith("/rows/batch"),
        ),
      ).toEqual([]);
      expect(
        (await state(page)).rows.some((row) => row.pageId === rowId(0)),
      ).toBe(true);
    } else {
      await expect
        .poll(
          async () =>
            (await state(page)).requests.filter((request) =>
              request.path.endsWith("/rows/batch"),
            ).length,
        )
        .toBe(1);
      expect(
        (await state(page)).requests.find((request) =>
          request.path.endsWith("/rows/batch"),
        ).path,
      ).toBe("/databases/10000000-0000-4000-8000-000000000001/rows/batch");
    }
  });
