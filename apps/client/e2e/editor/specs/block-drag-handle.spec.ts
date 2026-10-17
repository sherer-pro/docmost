import type { Locator, Page } from "@playwright/test";
import {
  apiGet,
  apiPost,
  createAdminApi,
  createPage,
  loadAuditState,
  updatePageContent,
} from "../support/api";
import { pageUrl } from "../support/complex-document";
import { expect, mainEditor, test } from "../support/audit-test";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const content = {
  type: "doc",
  content: [
    paragraph("First block"),
    {
      type: "blockquote",
      content: [
        paragraph("First nested block"),
        paragraph("Second nested block"),
      ],
    },
    {
      type: "callout",
      attrs: { type: "info" },
      content: [
        paragraph("Callout nested block"),
        paragraph("Keep callout block"),
      ],
    },
    {
      type: "details",
      attrs: { open: true },
      content: [
        {
          type: "detailsSummary",
          content: [{ type: "text", text: "Toggle block" }],
        },
        { type: "detailsContent", content: [paragraph("Toggle nested block")] },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 7 },
      content: [
        { type: "listItem", content: [paragraph("Ordered source item")] },
        { type: "listItem", content: [paragraph("Keep ordered item")] },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [paragraph("Checked source item")],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [paragraph("Keep task item")],
        },
      ],
    },
    paragraph("Destination block"),
  ],
};

async function json(editor: Locator) {
  return editor.evaluate((element) => (element as any).editor.getJSON());
}

async function move(
  page: Page,
  source: Locator,
  destination: Locator,
  smooth = false,
) {
  await source.hover();
  const handle = page.locator(".block-drag-handle");
  await expect(handle).not.toHaveClass(/hide/);
  await expect(handle).toHaveAttribute("aria-label", "Move block");
  const from = (await handle.boundingBox())!;
  const node = (await source.boundingBox())!;
  expect(from.width).toBeCloseTo(32, 2);
  expect(from.height).toBeCloseTo(32, 2);
  expect(from.x + from.width).toBeLessThanOrEqual(node.x - 3);
  await page.evaluate(() => {
    (window as any).__lastBlockMove = [];
    if ((window as any).__blockMoveTraceInstalled) return;
    (window as any).__blockMoveTraceInstalled = true;
    for (const type of ["mousedown", "dragstart", "drop", "dragend"])
      document.addEventListener(
        type,
        (event) => {
          const e = event as DragEvent;
          const live = (
            document.querySelector(
              '.ProseMirror[role="textbox"][aria-multiline="true"]',
            ) as any
          )?.editor;
          if (!live) return;
          const plugin = live.state.plugins.find((item: any) =>
            item.key.startsWith("blockDragHandle$"),
          );
          const state = plugin?.getState(live.state);
          (window as any).__lastBlockMove.push({
            type,
            tag: (e.target as Element)?.tagName,
            cls: (e.target as Element)?.getAttribute("class"),
            x: e.clientX,
            y: e.clientY,
            point: live.view.posAtCoords({ left: e.clientX, top: e.clientY }),
            selection: live.state.selection.toJSON(),
            dragging: Boolean(live.view.dragging),
            range: state && {
              from: state.range?.from,
              to: state.range?.to,
              cancelled: state.cancelled,
            },
          });
        },
        true,
      );
  });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2, {
    steps: 8,
  });
  await destination.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest" }),
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const to = (await destination.boundingBox())!;
  await page.mouse.move(to.x + 12, to.y + 1, { steps: smooth ? 20 : 1 });
  await page.mouse.up();
  return page.evaluate(() => (window as any).__lastBlockMove);
}

test("moves nested blocks and list items, preserves history and persisted content", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const me = await apiGet<any>(api, "/api/users/me");
  const original = me.user.settings?.preferences ?? {};
  const record = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} block drag`,
    content,
  );
  await apiPost(api, "/api/users/update", {
    pageEditModeByPageId: {
      ...(original.pageEditModeByPageId ?? {}),
      [record.id]: "edit",
    },
  });
  try {
    await page.goto(pageUrl(state, record));
    const editor = mainEditor(page);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(editor).toContainText("Keep task item");
    await editor.evaluate((element) => {
      const live = (element as any).editor;
      const events: any[] = [];
      (window as any).__blockDragEvents = events;
      const snapshot = () => {
        const plugin = live.state.plugins.find((item: any) =>
          item.key.startsWith("blockDragHandle$"),
        );
        const active = plugin?.getState(live.state);
        return {
          dragging: Boolean(live.view.dragging),
          editable: live.isEditable,
          selection: live.state.selection.toJSON(),
          active: active && {
            cancelled: active.cancelled,
            from: active.range?.from,
            to: active.range?.to,
          },
        };
      };
      live.on("transaction", ({ transaction }: any) =>
        events.push({
          type: "transaction",
          steps: transaction.steps.map((step: any) => step.toJSON()),
          uiEvent: transaction.getMeta("uiEvent"),
          ...snapshot(),
        }),
      );
      for (const type of ["mousedown", "dragstart", "drop", "dragend"])
        document.addEventListener(
          type,
          (event) => {
            const drag = event as DragEvent;
            const target = drag.target as HTMLElement;
            const point = live.view.posAtCoords({
              left: drag.clientX,
              top: drag.clientY,
            });
            events.push({
              type,
              phase: "capture",
              tag: target.tagName,
              text: target.textContent?.slice(0, 50),
              point,
              ...snapshot(),
            });
            queueMicrotask(() =>
              events.push({ type, phase: "after", ...snapshot() }),
            );
          },
          true,
        );
    });
    const before = await json(editor);
    const source = editor.locator("blockquote p").first();
    await move(
      page,
      source,
      editor.getByText("Destination block", { exact: true }),
      true,
    );
    await testInfo.attach("block-drag-events", {
      body: JSON.stringify(
        await page.evaluate(() => (window as any).__blockDragEvents),
        null,
        2,
      ),
      contentType: "application/json",
    });
    await expect(editor.locator("blockquote")).not.toContainText(
      "First nested block",
    );
    await expect(editor.locator("blockquote")).toContainText(
      "Second nested block",
    );
    await editor.click();
    await page.keyboard.press("Control+z");
    await expect.poll(() => json(editor)).toEqual(before);
    await page.keyboard.press("Control+y");
    await expect(editor.locator("blockquote")).not.toContainText(
      "First nested block",
    );

    await move(
      page,
      editor.getByText("Callout nested block", { exact: true }),
      editor.getByText("Destination block", { exact: true }),
    );
    await expect(
      editor.getByText("Keep callout block", { exact: true }),
    ).toBeVisible();

    await move(
      page,
      editor.getByText("Toggle nested block", { exact: true }),
      editor.getByText("Destination block", { exact: true }),
    );
    await expect(
      editor.locator('[data-type="detailsContent"]'),
    ).not.toContainText("Toggle nested block");

    await move(
      page,
      editor.getByText("Ordered source item", { exact: true }),
      editor.getByText("Destination block", { exact: true }),
    );
    const ordered = editor
      .locator("ol")
      .filter({ hasText: "Ordered source item" });
    await expect(ordered).toHaveAttribute("start", "7");
    await expect(ordered).not.toContainText("Keep ordered item");

    await move(
      page,
      editor.getByText("Checked source item", { exact: true }),
      editor.getByText("First block", { exact: true }),
    );
    await expect(
      editor
        .locator('li[data-checked="true"]')
        .filter({ hasText: "Checked source item" }),
    ).toHaveCount(1);
    const after = await json(editor);
    await expect
      .poll(async () => {
        const saved = await apiGet<any>(
          api,
          `/api/pages/info?pageId=${record.id}&includeContent=true`,
        );
        return editor.evaluate(
          (element, value) =>
            (element as any).editor.schema.nodeFromJSON(value).toJSON(),
          saved.content,
        );
      })
      .toEqual(after);
    await page.reload();
    await expect.poll(() => json(mainEditor(page))).toEqual(after);
  } finally {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    });
    await api.dispose();
  }
});

test("moves code blocks at every width and blocks in database descriptions", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const me = await apiGet<any>(api, "/api/users/me");
  const original = me.user.settings?.preferences ?? {};
  const record = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} wide block drag`,
    {
      type: "doc",
      content: [
        paragraph("Before code"),
        ...(["normal", "wide", "full"] as const).map((widthMode) => ({
          type: "codeBlock",
          attrs: { language: "mermaid", widthMode },
          content: [
            { type: "text", text: `graph TD; A[${widthMode}] --> B[Finish]` },
          ],
        })),
        paragraph("Code destination"),
      ],
    },
  );
  const database = await apiPost<any>(api, "/api/databases", {
    spaceId: state.spaceId,
    parentPageId: record.id,
    name: "Block drag description",
  });
  const databasePage = await apiGet<any>(
    api,
    `/api/pages/info?pageId=${database.pageId}`,
  );
  await updatePageContent(api, database.pageId, {
    type: "doc",
    content: [
      paragraph("Description source"),
      paragraph("Description middle"),
      paragraph("Description destination"),
    ],
  });
  try {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [record.id]: "edit",
        [database.pageId]: "edit",
      },
    });
    await page.goto(pageUrl(state, record));
    const editor = mainEditor(page);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    for (const fullPageWidth of [false, true]) {
      await apiPost(api, "/api/users/update", {
        fullPageWidthByPageId: {
          ...(original.fullPageWidthByPageId ?? {}),
          [record.id]: fullPageWidth,
        },
      });
      await page.reload();
      await expect(editor).toHaveAttribute("contenteditable", "true");
      await expect(
        editor.getByRole("img", { name: "Mermaid diagram", exact: true }),
      ).toHaveCount(3);
      for (const width of ["normal", "wide", "full"]) {
        const source = editor.locator(
          `.blockWidthWrapper[data-block-width-mode="${width}"]`,
        );
        await expect(source).toBeVisible();
        const before = await json(editor);
        const trace = await move(
          page,
          source,
          editor.getByText(
            width === "full" ? "Before code" : "Code destination",
            { exact: true },
          ),
        );
        await expect
          .poll(() => json(editor), {
            message: `Move ${width}, full page ${fullPageWidth}: ${JSON.stringify(trace)}`,
          })
          .not.toEqual(before);
        await editor.click();
        await page.keyboard.press("Control+z");
        await expect.poll(() => json(editor)).toEqual(before);
      }
    }
    await page.goto(pageUrl(state, databasePage));
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "true");
    await move(
      page,
      mainEditor(page).getByText("Description source", { exact: true }),
      mainEditor(page).getByText("Description destination", { exact: true }),
    );
    await expect
      .poll(async () => {
        const value = await json(mainEditor(page));
        return value.content.map((node: any) => node.content?.[0]?.text);
      })
      .toEqual([
        "Description middle",
        "Description source",
        "Description destination",
      ]);
    await page.setViewportSize({ width: 601, height: 900 });
    await mainEditor(page)
      .getByText("Description source", { exact: true })
      .hover();
    await expect
      .poll(async () => {
        const h = (await page.locator(".block-drag-handle").boundingBox())!;
        const p = (await mainEditor(page)
          .getByText("Description source", { exact: true })
          .boundingBox())!;
        return h.x + h.width - p.x;
      })
      .toBeLessThanOrEqual(-3);
  } finally {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
      fullPageWidthByPageId: original.fullPageWidthByPageId ?? {},
    });
    await api.dispose();
  }
});

test("keeps block handles outside text across sizes and modes and hides them in read mode", async ({
  page,
}, testInfo) => {
  const api = await createAdminApi();
  const state = await loadAuditState();
  const me = await apiGet<any>(api, "/api/users/me");
  const original = me.user.settings?.preferences ?? {};
  const record = await createPage(
    api,
    state.spaceId,
    `${testInfo.project.name} drag geometry`,
    content,
  );
  try {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [record.id]: "edit",
      },
    });
    await page.goto(pageUrl(state, record));
    for (const width of [1280, 768, 601]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) =>
            document.documentElement.setAttribute(
              "data-mantine-color-scheme",
              value,
            ),
          theme,
        );
        const source = mainEditor(page).getByText("First block", {
          exact: true,
        });
        const handle = page.locator(".block-drag-handle");
        await expect
          .poll(async () => {
            await source.hover();
            return handle.evaluate(
              (element) => !element.classList.contains("hide"),
            );
          })
          .toBe(true);
        await expect
          .poll(async () => {
            const h = (await handle.boundingBox())!,
              p = (await source.boundingBox())!;
            return h.x + h.width - p.x;
          })
          .toBeLessThanOrEqual(-3);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
    }
    await page.setViewportSize({ width: 600, height: 900 });
    await mainEditor(page).getByText("First block", { exact: true }).hover();
    await expect(page.locator(".block-drag-handle")).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 900 });
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: {
        ...(original.pageEditModeByPageId ?? {}),
        [record.id]: "read",
      },
    });
    await page.reload();
    await expect(mainEditor(page)).toHaveAttribute("contenteditable", "false");
    await expect(page.locator(".block-drag-handle:not(.hide)")).toHaveCount(0);
  } finally {
    await apiPost(api, "/api/users/update", {
      pageEditModeByPageId: original.pageEditModeByPageId ?? {},
    });
    await api.dispose();
  }
});
