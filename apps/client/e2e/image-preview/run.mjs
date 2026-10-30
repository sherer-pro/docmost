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
  const recorder = await browser.newPage();
  const video = Buffer.from(
    await recorder.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const stream = canvas.captureStream(15);
      const media = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8",
      });
      const chunks = [];
      media.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => {
        media.onstop = resolve;
      });
      media.start();
      const draw = setInterval(() => {
        canvas.getContext("2d").fillStyle = "#364fc7";
        canvas.getContext("2d").fillRect(0, 0, 160, 90);
      }, 50);
      await new Promise((resolve) => setTimeout(resolve, 400));
      media.stop();
      await stopped;
      clearInterval(draw);
      stream.getTracks().forEach((track) => track.stop());
      return btoa(
        String.fromCharCode(
          ...new Uint8Array(await new Blob(chunks).arrayBuffer()),
        ),
      );
    }),
    "base64",
  );
  await recorder.setContent("<h1>Synthetic gallery PDF</h1>");
  const pdf = await recorder.pdf();
  await recorder.close();
  const audio = Buffer.alloc(44 + 16000);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(16000, 40);
  for (const width of process.argv.includes("--pdf-only")
    ? []
    : [1280, 390, 320]) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 850 },
        hasTouch: true,
      });
      const page = await context.newPage();
      await page.route("**/api/attachments/files/**", (route) => {
        const url = route.request().url();
        return route.fulfill(
          url.endsWith(".pdf")
            ? { contentType: "application/pdf", body: pdf }
            : url.endsWith(".wav")
              ? { contentType: "audio/wav", body: audio }
              : url.endsWith(".webm")
                ? { contentType: "video/webm", body: video }
                : {
                    contentType: "image/png",
                    body: Buffer.from(
                      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=",
                      "base64",
                    ),
                  },
        );
      });
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
      await page
        .getByRole("button", { name: "Open gallery", exact: true })
        .click();
      let media = page.getByRole("dialog", {
        name: "gallery.png",
        exact: true,
      });
      await expect(media.locator("img")).toBeVisible();
      const nextButton = media
        .locator("button")
        .filter({ has: page.locator("svg.tabler-icon-arrow-right") });
      await nextButton.click();
      media = page.getByRole("dialog", { name: "gallery.wav", exact: true });
      await expect
        .poll(() =>
          media.locator("audio").evaluate((element) => element.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await media.locator("audio").evaluate((element) => element.play());
      await expect
        .poll(() =>
          media.locator("audio").evaluate((element) => element.currentTime),
        )
        .toBeGreaterThan(0);
      await media.locator("audio").focus();
      await page.keyboard.press("ArrowRight");
      await expect(media).toBeVisible();
      await media
        .locator("button")
        .filter({ has: page.locator("svg.tabler-icon-arrow-right") })
        .click();
      media = page.getByRole("dialog", { name: "gallery.webm", exact: true });
      await expect
        .poll(() =>
          media.locator("video").evaluate((element) => element.readyState),
        )
        .toBeGreaterThanOrEqual(2);
      await media.locator("video").evaluate((element) => element.play());
      await expect
        .poll(() =>
          media.locator("video").evaluate((element) => element.currentTime),
        )
        .toBeGreaterThan(0);
      await page.screenshot({
        path: path.join(output, `media-gallery-${width}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      await expect(media).toHaveCount(0);
      results.push({
        width,
        theme,
        locale,
        kind: "media gallery playback",
        passed: true,
      });
      console.log(`Passed: ${width}px ${theme} media gallery playback`);
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
  await browser.close();
  // PDF viewing requires full Chromium rather than the default headless shell.
  browser = await chromium.launch({ headless: true, channel: "chromium" });
  for (const width of [1280, 390]) {
    const theme = width === 1280 ? "light" : "dark";
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    activePage = page;
    await page.route("**/api/attachments/files/**", (route) =>
      route.fulfill({ contentType: "application/pdf", body: pdf }),
    );
    await page.goto(
      `http://127.0.0.1:5197/e2e/image-preview/preview.html?theme=${theme}&locale=en-US`,
    );
    await page
      .getByRole("button", { name: "Open gallery", exact: true })
      .click();
    for (let index = 0; index < 3; index++)
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Next", exact: true })
        .click();
    const dialog = page.getByRole("dialog", {
      name: "gallery.pdf",
      exact: true,
    });
    await expect(dialog.locator("iframe")).toBeVisible();
    // The native PDF viewer is outside the page DOM. A blank iframe has no
    // contrasting toolbar/page pixels; keep screenshots for visual inspection.
    await expect
      .poll(async () => {
        const pixels = (await dialog.locator("iframe").screenshot()).toString(
          "base64",
        );
        return page.evaluate(async (data) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${data}`)).blob(),
          );
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          const colors = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          let dark = 0,
            light = 0;
          for (let index = 0; index < colors.length; index += 4) {
            if (
              colors[index] < 100 &&
              colors[index + 1] < 100 &&
              colors[index + 2] < 100
            )
              dark++;
            if (
              colors[index] > 240 &&
              colors[index + 1] > 240 &&
              colors[index + 2] > 240
            )
              light++;
          }
          return dark > 1000 && light > 1000;
        }, pixels);
      })
      .toBe(true);
    await page.screenshot({
      path: path.join(output, `pdf-gallery-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    results.push({
      width,
      theme,
      locale: "en-US",
      kind: "PDF gallery",
      passed: true,
    });
    console.log(`Passed: ${width}px ${theme} PDF gallery`);
    await page.close();
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
