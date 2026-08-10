import { randomUUID } from "node:crypto";
import {
  csrfHeaders,
  expect,
  loadState,
  messageComposer,
  openAssistant,
  pageUrl,
  test,
} from "../support";

function unwrap<T>(payload: { data?: T; success?: boolean } | T): T {
  if (
    payload &&
    typeof payload === "object" &&
    "success" in payload &&
    "data" in payload
  ) {
    return payload.data as T;
  }
  return payload as T;
}

test("owner and writer contexts stay authorized while private chats remain isolated", async ({
  browser,
  page,
}) => {
  const state = await loadState();
  const memberAuthToken = process.env.DOCMOST_MEMBER_AUTH_TOKEN;
  const memberCsrfToken = process.env.DOCMOST_MEMBER_CSRF_TOKEN;
  expect(memberAuthToken).toBeTruthy();
  expect(memberCsrfToken).toBeTruthy();
  const origin = process.env.DOCMOST_BASE_URL ?? "http://localhost:3000";
  const url = new URL(origin);

  const memberContext = await browser.newContext({ locale: "ru-RU" });
  await memberContext.addCookies([
    {
      name: "authToken",
      value: memberAuthToken!,
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: url.protocol === "https:",
    },
    {
      name: "csrfToken",
      value: memberCsrfToken!,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
      secure: url.protocol === "https:",
    },
  ]);
  const memberPage = await memberContext.newPage();
  try {
    await Promise.all([
      openAssistant(page, state),
      memberPage.goto(`${origin}${pageUrl(state)}`),
    ]);
    await openAssistant(memberPage, state);
    await expect(messageComposer(page)).toBeVisible();
    await expect(messageComposer(memberPage)).toBeVisible();

    const forbiddenUpdate = await memberContext.request.patch(
      `${origin}/api/spaces/${state.spaceId}/ai/config`,
      {
        data: { temperature: 0.5 },
        headers: csrfHeaders(memberCsrfToken!, origin),
      },
    );
    expect(forbiddenUpdate.status()).toBe(403);

    const ownerCreate = await page.request.post("/api/ai/conversations", {
      data: {
        pageId: state.pageId,
        clientRequestId: `owner-${randomUUID()}`,
        title: "Owner private conversation",
      },
      headers: csrfHeaders(process.env.DOCMOST_CSRF_TOKEN!, origin),
    });
    expect(ownerCreate.status()).toBe(201);
    const ownerConversation = unwrap<{ id: string }>(await ownerCreate.json());
    const memberReadsOwner = await memberContext.request.get(
      `${origin}/api/ai/conversations/${ownerConversation.id}`,
    );
    expect([403, 404]).toContain(memberReadsOwner.status());

    const memberCreate = await memberContext.request.post(
      `${origin}/api/ai/conversations`,
      {
        data: {
          pageId: state.pageId,
          clientRequestId: `member-${randomUUID()}`,
          title: "Member private conversation",
        },
        headers: csrfHeaders(memberCsrfToken!, origin),
      },
    );
    expect(memberCreate.status()).toBe(201);
    const memberConversation = unwrap<{ id: string }>(await memberCreate.json());
    const ownerReadsMember = await page.request.get(
      `/api/ai/conversations/${memberConversation.id}`,
    );
    expect([403, 404]).toContain(ownerReadsMember.status());

    await memberPage.goto(`${origin}/settings/ai/spaces/${state.spaceSlug}`);
    await expect(
      memberPage.getByRole("button", { name: /Модель|Model/, exact: true }),
    ).toHaveCount(0);
  } finally {
    await memberContext.close();
  }
});
