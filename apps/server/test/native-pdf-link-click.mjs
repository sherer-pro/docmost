import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium, expect } from '../../client/e2e/database/api-context.mjs';

export async function verifyNativePdfLinkClick({
  pdf,
  annotation,
  expectedUrl,
  pageId,
  storageState,
  output,
}) {
  assert.equal(annotation.uri, expectedUrl);
  assert.equal(
    annotation.rotation,
    0,
    'The native click probe requires an unrotated exported page',
  );
  const { x0, x1, top, bottom } = annotation.rect;
  assert(
    x1 > x0 && bottom > top && annotation.width > 0 && annotation.height > 0,
  );
  let browser;
  const server = createServer((request, response) => {
    if (request.url !== '/document.pdf') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="export.pdf"',
      'Content-Length': pdf.length,
    });
    response.end(pdf);
  });
  await new Promise((resolve, reject) =>
    server.listen(0, '127.0.0.1', resolve).once('error', reject),
  );
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      channel: 'chromium',
      timeout: 15000,
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      storageState,
    });
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return ['http:', 'https:'].includes(url.protocol) &&
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        ? route.abort('blockedbyclient')
        : route.continue();
    });
    const page = await context.newPage();
    await page.goto(`${origin}/document.pdf`, { timeout: 15000 });
    await expect
      .poll(
        () =>
          page
            .frames()
            .some((frame) => frame.url().startsWith('chrome-extension://')),
        { timeout: 15000 },
      )
      .toBe(true);
    const viewerFrame = page
      .frames()
      .find((frame) => frame.url().startsWith('chrome-extension://'));
    const index = annotation.page - 1;
    await viewerFrame.waitForFunction(
      (pageIndex) => {
        const viewer = document.querySelector('pdf-viewer');
        return (
          viewer?.initialLoadComplete_ &&
          viewer?.viewport_?.getPageScreenRect &&
          viewer.documentDimensions?.pageDimensions?.length > pageIndex
        );
      },
      index,
      { timeout: 15000 },
    );
    await viewerFrame.evaluate((pageIndex) => {
      const viewport = document.querySelector('pdf-viewer').viewport_;
      viewport.fitToPage();
      viewport.goToPage(pageIndex);
    }, index);
    const pluginFrame = page
      .frames()
      .find(
        (frame) =>
          frame.parentFrame() === viewerFrame &&
          frame.url() === `${origin}/document.pdf`,
      );
    assert(
      pluginFrame,
      'Full Chromium must expose its native PDF plugin frame',
    );
    let geometry;
    await expect
      .poll(
        async () => {
          const plugin = await pluginFrame
            .locator('embed[type="application/x-google-chrome-pdf"]')
            .boundingBox();
          const native = await viewerFrame.evaluate((pageIndex) => {
            const viewport = document.querySelector('pdf-viewer').viewport_;
            return {
              paper: viewport.getPageScreenRect(pageIndex),
              zoom: viewport.getZoom(),
              rotation: viewport.getClockwiseRotations(),
            };
          }, index);
          if (
            !plugin ||
            native.rotation !== 0 ||
            native.paper.width <= 0 ||
            native.paper.height <= 0
          )
            return false;
          const point = {
            x:
              plugin.x +
              native.paper.x +
              ((x0 + x1) / 2 / annotation.width) * native.paper.width,
            y:
              plugin.y +
              native.paper.y +
              ((top + bottom) / 2 / annotation.height) * native.paper.height,
          };
          geometry = { plugin, native, point };
          return (
            point.x > plugin.x &&
            point.x < plugin.x + plugin.width &&
            point.y > plugin.y &&
            point.y < plugin.y + plugin.height
          );
        },
        { timeout: 10000 },
      )
      .toBe(true);
    assert(
      Math.abs(
        geometry.native.paper.width / geometry.native.paper.height -
          annotation.width / annotation.height,
      ) < 0.001,
      'Observed native page geometry must match the actual PDF page',
    );
    const nativeHit = await pluginFrame.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return (
          element?.tagName === 'EMBED' &&
          element.getAttribute('type') === 'application/x-google-chrome-pdf'
        );
      },
      {
        x: geometry.point.x - geometry.plugin.x,
        y: geometry.point.y - geometry.plugin.y,
      },
    );
    assert(
      nativeHit,
      'The click must hit the native PDF plugin, never an HTML link or overlay',
    );
    await page.screenshot({
      path: path.join(output, 'ui-export-native-pdf-before.png'),
    });
    await Promise.all([
      page.waitForURL(expectedUrl, { timeout: 15000 }),
      page.mouse.click(geometry.point.x, geometry.point.y),
    ]);
    assert.equal(page.url(), expectedUrl);
    const read = await context.request.get(
      new URL(`/api/pages/info?pageId=${pageId}`, expectedUrl).href,
    );
    assert.equal(
      read.status(),
      200,
      'The reader must retain access after the native PDF click',
    );
    const payload = await read.json();
    const current = payload.data ?? payload;
    assert.equal(current.id, pageId);
    assert.equal(current.access?.capabilities?.canRead, true);
    await page.screenshot({
      path: path.join(output, 'ui-export-native-pdf-after.png'),
    });
    return {
      passed: true,
      browserVersion: browser.version(),
      nativeViewer: true,
      geometry,
      navigatedUrl: page.url(),
      sourcePageAclRead: true,
    };
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
