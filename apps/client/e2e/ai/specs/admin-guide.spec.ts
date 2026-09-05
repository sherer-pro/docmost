import path from "node:path";
import { auditRoot, expect, test } from "../support";

const anchors = [
  "assistant",
  "retrieval",
  "rag-api",
  "rag-sync",
  "inbound-mcp",
  "outbound-mcp",
  "security",
  "troubleshooting",
] as const;

test("administrator AI guide is a separate localized release surface", async ({
  page,
}, testInfo) => {
  const isEnglish = testInfo.project.name.includes("en-");
  const copy = isEnglish
    ? {
        tab: "Guide",
        title: "How AI, RAG, and MCP work",
        overview: "Choose what you need to set up",
        navigation: "AI guide sections",
        technical: "Technical details",
        projection: "projectionVersion: 2",
      }
    : {
        tab: "Справка",
        title: "Как работают ИИ, RAG и MCP",
        overview: "Выберите нужный контур",
        navigation: "Разделы справки об ИИ",
        technical: "Технические подробности",
        projection: "projectionVersion: 2",
      };

  await page.goto("/settings/ai/guide");
  await expect(page).toHaveURL(/\/settings\/ai\/guide$/u);
  await expect(
    page.getByRole("tab", { name: copy.tab, exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: copy.title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: copy.overview, exact: true }),
  ).toBeVisible();

  const navigation = page.getByRole("navigation", {
    name: copy.navigation,
  });
  await expect(navigation).toBeVisible();
  for (const anchor of anchors) {
    await expect(
      navigation.locator(`a[href="/settings/ai/guide#${anchor}"]`),
    ).toHaveCount(1);
  }

  await page.screenshot({
    path: path.join(
      auditRoot,
      "screenshots",
      `ai-admin-guide-${testInfo.project.name}.png`,
    ),
    fullPage: true,
  });

  for (const anchor of anchors) {
    await navigation.locator(`a[href="/settings/ai/guide#${anchor}"]`).click();
    await expect(page).toHaveURL(
      new RegExp(`/settings/ai/guide#${anchor}$`, "u"),
    );
    await expect(page.locator(`#${anchor}`)).toBeVisible();
    await expect(
      page.locator(anchors.map((value) => `#${value}`).join(",")),
    ).toHaveCount(1);
  }

  await page.goto("/settings/ai/guide#rag-api");
  await page.getByRole("button", { name: copy.technical }).click();
  await expect(page.getByText(copy.projection, { exact: false })).toBeVisible();

  for (const anchor of ["assistant", "rag-sync"] as const) {
    await page.goto(`/settings/ai/guide#${anchor}`);
    await page.getByRole("button", { name: copy.technical }).click();
    await expect(
      page
        .locator(`#${anchor}`)
        .getByText("dictionary_term", { exact: false })
        .first(),
    ).toBeVisible();
  }

  await page.goto("/settings/ai/guide#troubleshooting");
  const ragSyncTroubleshooting = page.getByRole("button", {
    name: "RAG Sync",
    exact: true,
  });
  await expect(ragSyncTroubleshooting).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await ragSyncTroubleshooting.click();
  await expect(ragSyncTroubleshooting).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByText("rag_sync_target_mismatch", { exact: true }),
  ).toBeVisible();
});
