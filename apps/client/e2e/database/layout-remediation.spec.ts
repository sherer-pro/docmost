import { expect, test, type Page } from "@playwright/test";

const fixture = "/e2e/database/fixture.html";
const propertyId = (index: number) =>
  `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
async function settings(page: Page) {
  await page.getByRole("button", { name: /^View settings \(/ }).click();
  return page.getByRole("dialog", { name: "View settings", exact: true });
}
async function selectShared(page: Page) {
  await page.getByRole("textbox", { name: "View", exact: true }).click();
  await page.getByRole("option", { name: "Shared view", exact: true }).click();
}
async function sparseView(page: Page) {
  await page.route("**/api/databases/*/views", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data[0].config.visibleColumns = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [propertyId(i), false]),
    );
    payload.data[0].config.columnWidths = { [propertyId(0)]: 317 };
    await route.fulfill({ response, json: payload });
  });
}
test.beforeEach(async ({ request }) => {
  await request.post("/api/fixture/reset");
});

test("layout remediation waits for schema before choosing a Kanban group", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/databases/*/properties", async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto(fixture);
    const layout = page.getByRole("textbox", { name: "Layout", exact: true });
    await expect(layout).toBeDisabled();
    release();
    await expect(layout).toBeEnabled();
    await layout.click();
    await page.getByRole("option", { name: "Kanban", exact: true }).click();
    await expect(
      page
        .getByRole("group", { name: "Alpha", exact: true })
        .getByText("1000", { exact: true }),
    ).toBeVisible();
  } finally {
    release();
  }
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 390, 1024, 1440]) {
    for (const role of ["editor", "reader"]) {
      test(`layout remediation sparse ${role} ${theme} ${width}`, async ({
        page,
      }, info) => {
        await page.setViewportSize({ width, height: 900 });
        await sparseView(page);
        await page.goto(
          `${fixture}?theme=${theme}&role=${role}&embedded=1&view=70000000-0000-4000-8000-000000000001`,
        );
        await selectShared(page);
        const table = page.locator("table[data-sparse=true]");
        await expect(table).toBeVisible();
        const scroll = table.locator(
          "xpath=ancestor::*[contains(@class,'mantine-ScrollArea-viewport')][1]",
        );
        const geometry = await scroll.evaluate((node) => ({
          client: node.clientWidth,
          scroll: node.scrollWidth,
        }));
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
        const title = table.getByRole("columnheader", {
          name: "Title",
          exact: true,
        });
        expect((await title.boundingBox())!.width).toBeGreaterThan(
          width < 400 ? 160 : 500,
        );
        await table.getByRole("link", { name: "Row 0", exact: true }).focus();
        expect(
          await scroll.evaluate((node) => node.scrollLeft),
        ).toBeLessThanOrEqual(1);
        const toolbar = page.getByRole("toolbar", {
          name: "View settings",
          exact: true,
        });
        await expect(toolbar).toHaveAttribute("data-pinned", "false");
        if (width < 768) {
          expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(64);
          await expect(
            toolbar.getByRole("textbox", { name: "Layout", exact: true }),
          ).toHaveCount(0);
          await expect(
            toolbar.getByRole("button", { name: "Add property", exact: true }),
          ).toHaveCount(0);
        }
        const dialog = await settings(page);
        await dialog
          .getByRole("switch", { name: "Notes", exact: true })
          .check();
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect(table).toHaveCount(0);
        const header = page.locator(
          `th[data-database-property-id="${propertyId(0)}"]`,
        );
        await expect(header).toBeVisible();
        expect((await header.boundingBox())!.width).toBeGreaterThanOrEqual(316);
        await expect(
          header.getByRole("textbox", { name: "Property name", exact: true }),
        ).toHaveCount(0);
        await page.reload();
        await expect(header).toBeVisible();
        expect((await header.boundingBox())!.width).toBeGreaterThanOrEqual(316);
        await page.screenshot({
          path: info.outputPath(`layout-${role}-${theme}-${width}.png`),
        });
      });
    }
  }
  for (const width of [320, 390, 1440]) {
    test(`layout remediation Kanban ${theme} ${width}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${fixture}?theme=${theme}`);
      const dialog = width < 768 ? await settings(page) : null;
      await page.getByRole("textbox", { name: "Layout", exact: true }).click();
      await page.getByRole("option", { name: "Kanban", exact: true }).click();
      if (dialog)
        await dialog
          .getByRole("button", { name: "Close", exact: true })
          .click();
      const board = page.getByRole("region", { name: "Kanban", exact: true });
      const column = board.getByRole("group", { name: "Alpha", exact: true });
      await expect(
        column.getByRole("button", { name: "Row 0", exact: true }),
      ).toBeVisible();
      const viewport = board.locator(
        "xpath=ancestor::*[contains(@class,'mantine-ScrollArea-viewport')][1]",
      );
      const client = await viewport.evaluate((node) => node.clientWidth);
      expect((await column.boundingBox())!.width).toBeLessThanOrEqual(
        client + 1,
      );
      const scrollWidth = await viewport.evaluate((node) => node.scrollWidth);
      if (width < 768) expect(scrollWidth).toBeGreaterThan(client);
      else expect(scrollWidth).toBeGreaterThanOrEqual(client);
      const toolbar = page.getByRole("toolbar", {
        name: "View settings",
        exact: true,
      });
      if (width < 768) {
        expect((await toolbar.boundingBox())!.height).toBeLessThanOrEqual(64);
        const controls = await settings(page);
        await controls
          .getByRole("button", { name: "Unpin toolbar", exact: true })
          .click();
        await controls
          .getByRole("button", { name: "Close", exact: true })
          .click();
        await expect(toolbar).toHaveAttribute("data-pinned", "false");
        await page.reload();
        await expect(toolbar).toHaveAttribute("data-pinned", "false");
      }
      await page.screenshot({
        path: info.outputPath(`kanban-${theme}-${width}.png`),
      });
    });
  }
}
