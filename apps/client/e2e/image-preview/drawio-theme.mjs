import assert from "node:assert/strict";
import { expect } from "@playwright/test";

// Three equal bands: white background, black ink and a blue accent.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAAoCAIAAAC6iKlyAAAAW0lEQVR42u3QQREAIAwEsR4akIhE/BUZ5ZE1sDNJd9dESUa++9yR7yqBBi3QoEELNGiBBg1aoEELNGjQAg1aoEGDFmjQAg0atECDFmjQoAUatECDBi3QoAX6ux5FJQR8NCRZ2gAAAABJRU5ErkJggg==";
const model =
  "&lt;mxfile&gt;&lt;diagram&gt;&lt;mxGraphModel&gt;&lt;root/&gt;&lt;/mxGraphModel&gt;&lt;/diagram&gt;&lt;/mxfile&gt;";
const header = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="120" height="40" viewBox="0 0 120 40" content="${model}">`;
const raster = `${header}<image width="120" height="40" xlink:href="data:image/png;base64,${png}"/></svg>`;
const vector = `${header}<style>@media(prefers-color-scheme:dark){#paper{fill:#222}#ink{fill:#eee}}</style><rect id="paper" width="40" height="40" fill="white"/><rect id="ink" x="40" width="40" height="40" fill="black"/><rect x="80" width="40" height="40" fill="#1464b4"/></svg>`;

async function sampleBands(page, image) {
  const screenshot = (await image.screenshot()).toString("base64");
  return page.evaluate(async (encoded) => {
    const bitmap = await createImageBitmap(
      await (await fetch(`data:image/png;base64,${encoded}`)).blob(),
    );
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    // The modal fits the 3:1 diagram inside a viewport of a different ratio.
    const width = Math.min(canvas.width, 3 * canvas.height);
    const left = (canvas.width - width) / 2;
    return [1, 3, 5].map((offset) => {
      const x = left + (width * offset) / 6;
      return Array.from(
        ctx.getImageData(x, canvas.height / 2, 1, 1).data,
      ).slice(0, 3);
    });
  }, screenshot);
}

async function checkPixels(page, image, theme, title, nativeBands) {
  await expect(image).toBeVisible();
  const message = `${title} rendered in ${theme} theme`;
  if (title === "Vector") {
    // Browser support for propagating the page's scheme to SVG images varies.
    await expect
      .poll(() => sampleBands(page, image), { message })
      .toEqual(nativeBands);
    return;
  }
  await expect
    .poll(
      async () => {
        const [paper, ink, accent] = await sampleBands(page, image);
        if (theme === "light") return JSON.stringify([paper, ink, accent]);
        const blue = accent[2] - accent[0] > 45 && accent[2] > accent[1];
        return paper.every((value) => value < 80) &&
          ink.every((value) => value > 175) &&
          blue
          ? "dark"
          : JSON.stringify([paper, ink, accent]);
      },
      { message },
    )
    .toBe(
      theme === "dark"
        ? "dark"
        : JSON.stringify([
            [255, 255, 255],
            [0, 0, 0],
            [20, 100, 180],
          ]),
    );
}

export async function checkDrawioTheme(page) {
  const writes = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(request.method());
  });
  await page.route("**/api/attachments/files/**", (route) => {
    const body = route.request().url().includes("111111111110/")
      ? raster
      : vector;
    return route.fulfill({ contentType: "image/svg+xml", body });
  });
  await page.goto(
    "http://127.0.0.1:5197/e2e/image-preview/preview.html?drawio&theme=dark",
  );
  const editor = page.locator(".tiptap");
  await expect(editor).toHaveAttribute("contenteditable", "false");
  for (const theme of ["dark", "light", "dark"]) {
    if (
      (await page.locator("html").getAttribute("data-mantine-color-scheme")) !==
      theme
    ) {
      await page.getByRole("button", { name: "Switch theme" }).click();
    }
    const nativeBands = await sampleBands(
      page,
      page.getByRole("img", { name: "Native SVG reference" }),
    );
    assert(Math.abs(nativeBands[0][0] - nativeBands[1][0]) > 150);
    assert.deepEqual(nativeBands[2], [20, 100, 180]);
    for (const title of ["MCP", "Vector"]) {
      const inline = editor.getByRole("img", { name: title });
      await checkPixels(page, inline, theme, title, nativeBands);
      await inline.click();
      const dialog = page.getByRole("dialog", { name: title });
      await checkPixels(
        page,
        dialog.getByRole("img", { name: title }),
        theme,
        title,
        nativeBands,
      );
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  }
  await expect(page.locator("iframe.diagrams-iframe")).toHaveCount(0);
  assert.deepEqual(writes, []);
}
