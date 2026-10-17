import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "vite";
import { chromium, expect } from "@playwright/test";

const clientRoot = fileURLToPath(new URL("../..", import.meta.url));
const output = path.resolve(clientRoot, "../../artifacts/image-preview");
process.chdir(clientRoot);
const server = await createServer({
  root: clientRoot,
  mode: "test",
  server: { host: "127.0.0.1", port: 5197, strictPort: true },
});
let browser;
let activePage;
const results = [];
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const width of [1280, 390, 320]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 850 },
        hasTouch: true,
      });
      const page = await context.newPage();
      activePage = page;
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const locale = width === 1280 ? "en-US" : "ru-RU";
      const labels =
        locale === "en-US"
          ? ["Zoom in", "Zoom out", "Reset zoom"]
          : ["Увеличить", "Уменьшить", "Сбросить масштаб"];
      await page.goto(
        `http://127.0.0.1:5197/e2e/image-preview/preview.html?theme=${theme}&locale=${locale}`,
      );
      for (const kind of ["image", "SVG", "Mermaid"]) {
        await page
          .getByRole("button", { name: `Open ${kind}`, exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const viewport = dialog.getByRole("region");
        const scale = dialog.locator("output");
        const reset = dialog.getByRole("button", {
          name: labels[2],
          exact: true,
        });
        await expect(scale).toHaveText("100%");
        await dialog
          .getByRole("button", { name: labels[0], exact: true })
          .click();
        await expect(scale).toHaveText("125%");
        await dialog
          .getByRole("button", { name: labels[1], exact: true })
          .click();
        await expect(scale).toHaveText("100%");
        const rect = await viewport.boundingBox();
        assert(
          rect && rect.width > 100 && rect.height > 100,
          JSON.stringify({ width, theme, kind, rect }),
        );
        const media = await viewport
          .locator("img, [role=img] svg")
          .boundingBox();
        assert(media && media.width > 0 && media.height > 0);
        assert(media.x >= rect.x - 1 && media.y >= rect.y - 1);
        assert(media.x + media.width <= rect.x + rect.width + 1);
        assert(media.y + media.height <= rect.y + rect.height + 1);
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, -100);
        await expect(scale).toHaveText("100%");
        await page.keyboard.down("Alt");
        await page.mouse.wheel(0, -80);
        await page.keyboard.up("Alt");
        await expect
          .poll(async () => parseInt(await scale.textContent()))
          .toBeGreaterThan(100);
        const before = await viewport
          .locator(":scope > div")
          .getAttribute("style");
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 40, y + 20, { steps: 5 });
        await page.mouse.up();
        assert.notEqual(
          await viewport.locator(":scope > div").getAttribute("style"),
          before,
        );
        await reset.click();
        await page.mouse.move(x, y);
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -50);
        await page.keyboard.up("Control");
        await expect
          .poll(async () => parseInt(await scale.textContent()))
          .toBeGreaterThan(100);
        await reset.click();
        await viewport.focus();
        await page.keyboard.press("+");
        await expect(scale).toHaveText("125%");
        await page.keyboard.press("0");
        await expect(scale).toHaveText("100%");

        const cdp = await context.newCDPSession(page);
        const points = (distance) => [
          { x: x - distance, y, id: 1 },
          { x: x + distance, y, id: 2 },
        ];
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: points(30),
        });
        for (const distance of [40, 50, 60, 75]) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: points(distance),
          });
        }
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await expect
          .poll(async () => parseInt(await scale.textContent()))
          .toBeGreaterThan(180);
        await cdp.detach();
        assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
        const box = await dialog.boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1);
        for (const label of labels) {
          const button = await dialog
            .getByRole("button", { name: label, exact: true })
            .boundingBox();
          assert(
            button.width >= 44 &&
              button.height >= 44 &&
              button.y + button.height <= 850,
          );
        }
        if (kind === "SVG" && theme === "light")
          await page.screenshot({
            path: path.join(output, `zoom-${width}.png`),
          });
        await reset.click();
        await expect(scale).toHaveText("100%");
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        results.push({ width, theme, locale, kind, passed: true });
        console.log(`Passed: ${width}px ${theme} ${kind}`);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `Image preview browser acceptance: ${results.length} scenarios passed`,
  );
} catch (error) {
  if (activePage && !activePage.isClosed())
    await activePage
      .screenshot({ path: path.join(output, "failure.png") })
      .catch(() => {});
  console.error(`Completed ${results.length} scenarios before failure`);
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
