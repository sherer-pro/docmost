import { expect, test, type Page } from "@playwright/test";

async function editViewName(page: Page, name: string) {
  await page.getByRole("button", { name: /^View settings \(/ }).click();
  const settings = page.getByRole("dialog", {
    name: "View settings",
    exact: true,
  });
  await settings.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
}
async function expectViewName(page: Page, name: string) {
  await page.getByRole("button", { name: /^View settings \(/ }).click();
  const settings = page.getByRole("dialog", {
    name: "View settings",
    exact: true,
  });
  await expect(
    settings.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue(name);
  await settings.getByRole("button", { name: "Close", exact: true }).click();
}

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

test("Kanban uses complete column counts, independent pagination and revision-checked moves", async ({
  page,
}, info) => {
  await page.goto(fixtureUrl);
  await page.getByRole("textbox", { name: "Layout", exact: true }).click();
  await page.getByRole("option", { name: "Kanban", exact: true }).click();
  const board = page.getByRole("region", { name: "Kanban", exact: true });
  const alpha = board.getByRole("group", { name: "Alpha", exact: true });
  const beta = board.getByRole("group", { name: "Beta", exact: true });
  await expect(alpha.getByText("1000", { exact: true })).toBeVisible();
  await expect(alpha.getByRole("button", { name: /^Row / })).toHaveCount(30);
  await alpha.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(alpha.getByRole("button", { name: /^Row / })).toHaveCount(60);
  await alpha
    .getByRole("textbox", { name: "Move to column", exact: true })
    .first()
    .click();
  await page.getByRole("option", { name: "Beta", exact: true }).click();
  await expect(
    beta.getByRole("button", { name: "Row 0", exact: true }),
  ).toBeVisible();
  await expect(alpha.getByText("999", { exact: true })).toBeVisible();
  const saved = (await state(page)).requests.find(
    (request) =>
      request.method === "PATCH" &&
      request.path.includes(`/rows/${rowId(0)}/cells`),
  );
  expect(saved.body.cells).toEqual([
    {
      propertyId: "50000000-0000-4000-8000-000000000009",
      value: "b",
      expectedRevision: 1,
    },
  ]);
  await page.screenshot({ path: info.outputPath("kanban.png") });
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
      const toolbar = page.getByRole("toolbar", {
        name: "View settings",
        exact: true,
      });
      await expect(toolbar).toHaveAttribute("data-pinned", "true");
      await toolbar
        .getByRole("button", { name: "Unpin toolbar", exact: true })
        .click();
      await expect(toolbar).toHaveAttribute("data-pinned", "false");
      await page.reload();
      await expect(toolbar).toHaveAttribute("data-pinned", "false");
      await toolbar
        .getByRole("button", { name: "Pin toolbar", exact: true })
        .click();
      await toolbar
        .getByRole("button", { name: "Add property", exact: true })
        .click();
      await expect(
        page.getByRole("textbox", { name: "New column name", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("textbox", { name: "New column name", exact: true })
        .fill("Pending property");
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("textbox", { name: "New column name", exact: true }),
      ).toHaveCount(0);
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
    const event = new ClipboardEvent("paste", {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    });
    // Firefox strips constructor-supplied data from an untrusted paste event.
    Object.defineProperty(event, "clipboardData", { value: transfer });
    if (event.clipboardData?.getData("text") !== transfer.getData("text"))
      throw new Error("The synthetic clipboard fixture lost its payload");
    element.dispatchEvent(event);
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

test("explicit shared save preserves the second client draft on conflict", async ({
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
      target.getByRole("textbox", { name: "View", exact: true }),
    ).toHaveValue("Shared view");
  }
  expect(
    (await state(page)).requests.filter(
      (request) =>
        request.method === "PATCH" && request.path.includes("/views/"),
    ),
  ).toHaveLength(0);
  await editViewName(page, "First client");
  await expect(page.getByText("Personal draft", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Save for everyone", exact: true })
    .click();
  await expect
    .poll(async () => (await state(page)).views[0].name)
    .toBe("First client");
  await editViewName(other, "Second client");
  await other
    .getByRole("button", { name: "Save for everyone", exact: true })
    .click();
  await expect(
    other.getByText(
      "This view changed in another session. Your draft is preserved.",
    ),
  ).toBeVisible();
  await expectViewName(other, "Second client");
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

async function deferDatabaseTitleFocus(page: Page) {
  await page.addInitScript(() => {
    const schedule = window.setTimeout;
    const cancel = window.clearTimeout;
    const pending = new Map<number, () => void>();
    (window as any).__databaseTitleFocus = {
      pending,
      release: () => {
        for (const [id, callback] of pending) {
          pending.delete(id);
          callback();
        }
      },
    };
    window.setTimeout = ((callback, delay, ...args) => {
      if (
        delay === 300 &&
        typeof callback === "function" &&
        new Error().stack?.includes("/database-title-editor.tsx")
      ) {
        const id = schedule(() => {}, 0);
        pending.set(id, () => callback(...args));
        return id;
      }
      return schedule(callback, delay, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id) => {
      if (typeof id === "number") pending.delete(id);
      cancel(id);
    }) as typeof window.clearTimeout;
  });
}

async function releaseDatabaseTitleFocus(page: Page) {
  await page.evaluate(async () => {
    (window as any).__databaseTitleFocus.release();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
}

for (const header of ["filled", "empty"])
  test(`late ${header} database title initialization preserves the cell draft`, async ({
    page,
  }) => {
    await deferDatabaseTitleFocus(page);
    await page.goto(`${fixtureUrl}?header=${header}`);
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__databaseTitleFocus.pending.size),
      )
      .toBe(1);
    const cell = page.locator(
      `[data-database-cell-key="${rowId(0)}:${notesId}"]`,
    );
    await cell.press("F2");
    const editor = cell.getByRole("textbox");
    await editor.fill("Preserved during header initialization");
    await expect(editor).toBeFocused();
    await releaseDatabaseTitleFocus(page);
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue("Preserved during header initialization");
    expect(
      (await state(page)).requests.filter(
        (request) =>
          request.method === "PATCH" && request.path.endsWith("/cells"),
      ),
    ).toHaveLength(0);
  });

test("an empty database title receives initial focus when no control was chosen", async ({
  page,
}) => {
  await deferDatabaseTitleFocus(page);
  await page.goto(`${fixtureUrl}?header=empty`);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__databaseTitleFocus.pending.size),
    )
    .toBe(1);
  expect(
    await page.evaluate(() => document.activeElement === document.body),
  ).toBe(true);
  await releaseDatabaseTitleFocus(page);
  await expect(
    page.locator('[data-database-title-fixture] [contenteditable="true"]'),
  ).toBeFocused();
});

test("database title initialization cannot refocus after a later control choice", async ({
  page,
}) => {
  await deferDatabaseTitleFocus(page);
  await page.goto(`${fixtureUrl}?header=empty`);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__databaseTitleFocus.pending.size),
    )
    .toBe(1);
  const control = page.getByRole("button", {
    name: "Toggle database",
    exact: true,
  });
  await control.evaluate(async (button) => {
    (window as any).__databaseTitleFocus.release();
    button.focus();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
  await expect(control).toBeFocused();
});

test("pending cell focus preserves a newer cell choice before a blur save completes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const schedule = window.requestAnimationFrame;
    const cancel = window.cancelAnimationFrame;
    const pending = new Map<number, FrameRequestCallback>();
    (window as any).__databaseCellFocus = {
      pending,
      release: () => {
        for (const [id, callback] of pending) {
          pending.delete(id);
          callback(performance.now());
        }
      },
    };
    window.requestAnimationFrame = (callback) => {
      if (new Error().stack?.includes("/database-table-view.tsx")) {
        const id = schedule(() => {});
        pending.set(id, callback);
        return id;
      }
      return schedule(callback);
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
      cancel(id);
    };
  });
  await page.goto(fixtureUrl);
  const amount = page.locator(
    `[data-database-cell-key="${rowId(0)}:50000000-0000-4000-8000-000000000002"]`,
  );
  const date = page.locator(
    `[data-database-cell-key="${rowId(0)}:50000000-0000-4000-8000-000000000003"]`,
  );
  await amount.press("F2");
  await amount.getByRole("textbox").fill("10.25");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__databaseCellFocus.pending.size),
    )
    .toBe(1);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let saving = false;
  await page.route(
    "**/cells",
    async (route) => {
      saving = true;
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    await date.focus();
    await expect.poll(() => saving).toBe(true);
    await page.evaluate(() => (window as any).__databaseCellFocus.release());
    await expect(date).toBeFocused();
  } finally {
    const saved = saving
      ? page.waitForResponse((response) =>
          response.request().method() === "PATCH" &&
          response.url().endsWith("/cells"),
        )
      : undefined;
    release();
    if (saved) expect((await saved).ok()).toBe(true);
  }
});

test("late Enter navigation preserves a newly focused cell", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const amount = page.locator(
    `[data-database-cell-key="${rowId(0)}:50000000-0000-4000-8000-000000000002"]`,
  );
  const date = page.locator(
    `[data-database-cell-key="${rowId(0)}:50000000-0000-4000-8000-000000000003"]`,
  );
  await amount.press("F2");
  await amount.getByRole("textbox").fill("10.25");
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
  try {
    await amount.getByRole("textbox").press("Enter");
    await date.focus();
    release();
    await expect(amount).toHaveText("10.25");
    await expect(date).toBeFocused();
    await date.press("F2");
    await expect(
      date.getByRole("switch", { name: "Date range" }),
    ).toBeVisible();
    expect(
      (await state(page)).requests.filter(
        (request) =>
          request.method === "PATCH" && request.path.endsWith("/cells"),
      ),
    ).toHaveLength(1);
  } finally {
    release();
  }
});

test("Enter still navigates down after saving the active cell", async ({
  page,
}) => {
  await page.goto(fixtureUrl);
  const amount = (index: number) =>
    page.locator(
      `[data-database-cell-key="${rowId(index)}:50000000-0000-4000-8000-000000000002"]`,
    );
  await amount(0).press("F2");
  await amount(0).getByRole("textbox").fill("10.25");
  await amount(0).getByRole("textbox").press("Enter");
  await expect(amount(0)).toHaveText("10.25");
  await expect(amount(1).getByRole("textbox")).toHaveValue("1");
  await expect(amount(1).getByRole("textbox")).toBeFocused();
});

test("row selection snapshots checkbox values before deferred React updates", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fixtureUrl);
  const checkboxes = page.getByRole("checkbox", {
    name: "Select row",
    exact: true,
  });
  await expect(checkboxes.first()).toBeVisible();
  // Native clicks in one turn keep both state updates queued until events end.
  await checkboxes.evaluateAll((inputs) => {
    (inputs[0] as HTMLInputElement).click();
    (inputs[1] as HTMLInputElement).click();
  });
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).toBeChecked();
  await expect(page.getByText("Rows: 2", { exact: true })).toBeVisible();
  await checkboxes.evaluateAll((inputs) => {
    (inputs[0] as HTMLInputElement).click();
    (inputs[1] as HTMLInputElement).click();
  });
  await expect(checkboxes.nth(0)).not.toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Delete", exact: true }),
  ).toBeHidden();
  expect(errors).toEqual([]);
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
