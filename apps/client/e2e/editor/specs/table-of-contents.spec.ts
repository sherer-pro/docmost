import {
  apiGet,
  apiPost,
  createAdminApi,
  createPage,
  loadAuditState,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { expect, test } from "../support/audit-test";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});

async function assertStableTocNavigation(
  page: import("@playwright/test").Page,
  target: string,
  expectedMode: "docked" | "overlay",
) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Table of contents" }).click();

  const aside = page.locator("#docmost-context-aside");
  await expect(aside).toBeVisible();
  await expect(aside).toHaveAttribute("data-presentation-mode", expectedMode);
  await expect(aside.getByRole("separator")).toBeVisible();

  await aside.getByRole("button").filter({ hasText: target }).click();
  const targetHeading = page.getByRole("heading", {
    name: target,
    exact: true,
  });
  await expect
    .poll(async () =>
      targetHeading.evaluate((node) => node.getBoundingClientRect().top),
    )
    .toBeLessThan(180);
  const beforeClose = await targetHeading.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    bottom: node.getBoundingClientRect().bottom,
  }));
  expect(beforeClose.bottom).toBeGreaterThan(40);

  await aside.getByRole("button", { name: "Close panel" }).click();
  await page.waitForTimeout(500);

  const afterClose = await targetHeading.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    bottom: node.getBoundingClientRect().bottom,
  }));
  const scroll = await page.evaluate(() => ({
    y: window.scrollY,
    max: document.documentElement.scrollHeight - window.innerHeight,
    viewportHeight: window.innerHeight,
  }));
  expect(afterClose.bottom).toBeGreaterThan(40);
  expect(afterClose.top).toBeLessThan(scroll.viewportHeight / 2);
  expect(scroll.max - scroll.y).toBeGreaterThan(200);
}

test("keeps TOC targets visible after closing docked and overlay panels", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Responsive TOC coverage runs once in Chromium with controlled viewport widths",
  );

  const api = await createAdminApi();
  const state = await loadAuditState();
  const currentUser = await apiGet<any>(api, "/api/users/me");
  const originalLocale = currentUser.user.locale;
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const middleHeading = `Middle target ${suffix}`;
  const lowerHeading = `Lower target ${suffix}`;
  const filler = (section: string, index: number) =>
    paragraph(
      `${section} paragraph ${index} ${"Long document content ".repeat(18)}`,
    );
  const content = {
    type: "doc",
    content: [
      heading(`Start ${suffix}`),
      ...Array.from({ length: 24 }, (_, index) => filler("start", index)),
      heading(middleHeading),
      ...Array.from({ length: 24 }, (_, index) => filler("middle", index)),
      heading(lowerHeading),
      ...Array.from({ length: 24 }, (_, index) => filler("tail", index)),
    ],
  };

  try {
    const tocPage = await createPage(
      api,
      state.spaceId,
      `TOC navigation ${suffix}`,
      content,
    );
    await apiPost(api, "/api/users/update", { locale: "en-US" });
    await page.setViewportSize({ width: 1700, height: 900 });
    await page.goto(pageUrl(state, tocPage));
    await expect(
      page.getByRole("heading", { name: middleHeading }),
    ).toBeVisible();

    await assertStableTocNavigation(page, middleHeading, "docked");

    await page.setViewportSize({ width: 1100, height: 800 });
    await assertStableTocNavigation(page, lowerHeading, "overlay");
  } finally {
    await apiPost(api, "/api/users/update", { locale: originalLocale }).catch(
      () => undefined,
    );
    await api.dispose();
  }
});
