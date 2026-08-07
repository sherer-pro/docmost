import {
  apiGet,
  apiPost,
  createAdminApi,
  loadAuditState,
} from "../support/api";
import { pageUrl, seedComplexDocument } from "../support/complex-document";
import {
  captureStep,
  expect,
  mainEditor,
  runAxe,
  test,
} from "../support/audit-test";

test("mobile and touch rendering reflows without document-level horizontal overflow", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const current = await apiGet<any>(api, "/api/users/me");
  const original = current.user.settings?.preferences ?? {};
  const seeded = await seedComplexDocument(
    api,
    state,
    `${testInfo.project.name}-mobile`,
  );

  try {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [seeded.page.id]: "read",
      },
    });
    await page.goto(pageUrl(state, seeded.page));
    await expect(mainEditor(page)).toContainText("Editor regression audit");
    const viewport = page.viewportSize();
    expect(viewport?.width).toBeLessThanOrEqual(500);
    const overflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.documentWidth).toBeLessThanOrEqual(
      overflow.viewportWidth + 2,
    );
    await expect(page.locator(".tableWrapper")).toBeVisible();
    await page.getByAltText("Editor audit image alt text").tap();
    await expect(
      page.getByRole("dialog", {
        name: /Image preview|Предпросмотр изображения/,
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await runAxe(page, testInfo, "body");
    await captureStep(page, testInfo, "05-mobile-touch-reflow", {
      fullPage: true,
    });
  } finally {
    await apiPost(api, "/api/users/update", {
      fixedToolbar: original.fixedToolbar ?? false,
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    }).catch(() => undefined);
    await api.dispose();
  }
});
