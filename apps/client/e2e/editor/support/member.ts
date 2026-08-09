import { randomBytes } from "node:crypto";
import type { APIResponse, Browser, BrowserContext } from "@playwright/test";
import { apiGet, apiPost, parseResponse } from "./api";
import { baseUrl } from "./auth";
import type { APIRequestContext } from "@playwright/test";

export interface AuditMember {
  context: BrowserContext;
  userId: string;
  managedByRunner: boolean;
  get<T>(url: string): Promise<T>;
  post<T>(
    url: string,
    data: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<T>;
}

function wrapAuditMember(
  context: BrowserContext,
  userId: string,
  csrfToken: string,
  managedByRunner: boolean,
): AuditMember {
  const mutationHeaders = {
    Origin: baseUrl(),
    Referer: `${baseUrl()}/`,
    "x-csrf-token": csrfToken,
  };
  const parse = async <T>(response: Promise<APIResponse>) =>
    parseResponse<T>(await response);

  return {
    context,
    userId,
    managedByRunner,
    get: <T>(url: string) =>
      parse<T>(context.request.get(`${baseUrl()}${url}`)),
    post: <T>(
      url: string,
      data: Record<string, unknown>,
      headers: Record<string, string> = {},
    ) =>
      parse<T>(
        context.request.post(`${baseUrl()}${url}`, {
          data,
          headers: { ...mutationHeaders, ...headers },
        }),
      ),
  };
}

export async function getAuditEmailDomain(
  api: APIRequestContext,
): Promise<string> {
  const workspace = await apiGet<{ emailDomains?: string[] }>(
    api,
    "/api/workspace/info",
  );
  return workspace.emailDomains?.[0] ?? "example.com";
}

export async function provisionAuditMember(params: {
  api: APIRequestContext;
  browser: Browser;
  spaceId: string;
  role?: "reader" | "writer" | "admin";
}): Promise<AuditMember> {
  const sharedAuthToken = process.env.DOCMOST_AUDIT_MEMBER_AUTH_TOKEN?.trim();
  const sharedCsrfToken = process.env.DOCMOST_AUDIT_MEMBER_CSRF_TOKEN?.trim();
  const sharedUserId = process.env.DOCMOST_AUDIT_MEMBER_USER_ID?.trim();
  if (sharedAuthToken && sharedCsrfToken && sharedUserId) {
    const context = await params.browser.newContext({
      baseURL: baseUrl(),
      locale: "en-US",
    });
    const urls = [baseUrl(), process.env.DOCMOST_WEBKIT_BASE_URL]
      .filter((value): value is string => Boolean(value))
      .map((value) => new URL(value));
    const uniqueUrls = Array.from(
      new Map(urls.map((url) => [url.hostname, url])).values(),
    );
    await context.addCookies(
      uniqueUrls.flatMap((url) => [
        {
          name: "authToken",
          value: sharedAuthToken,
          domain: url.hostname,
          path: "/",
          httpOnly: true,
          sameSite: "Lax" as const,
          secure: url.protocol === "https:",
        },
        {
          name: "csrfToken",
          value: sharedCsrfToken,
          domain: url.hostname,
          path: "/",
          httpOnly: false,
          sameSite: "Lax" as const,
          secure: url.protocol === "https:",
        },
      ]),
    );
    return wrapAuditMember(context, sharedUserId, sharedCsrfToken, true);
  }

  const suffix = randomBytes(5).toString("hex");
  const emailDomain = await getAuditEmailDomain(params.api);
  const email = "templates-transclusion-" + suffix + "@" + emailDomain;
  const password = `Aa1!${randomBytes(18).toString("base64url")}`;

  await apiPost(params.api, "/api/workspace/invites/create", {
    emails: [email],
    role: "member",
    groupIds: [],
  });
  const invites = await apiGet<any>(
    params.api,
    "/api/workspace/invites?limit=100",
  );
  const invitation = (invites.items ?? invites.data ?? []).find(
    (item: any) => item.email === email,
  );
  if (!invitation) throw new Error("Audit member invitation was not found");

  const link = await apiPost<{ inviteLink: string }>(
    params.api,
    "/api/workspace/invites/link",
    { invitationId: invitation.id },
  );
  const invitationUrl = new URL(link.inviteLink);
  const invitationId = invitationUrl.pathname.split("/").filter(Boolean).at(-1);
  const token = invitationUrl.searchParams.get("token");
  if (!invitationId || !token) {
    throw new Error("Audit invitation link is incomplete");
  }

  const context = await params.browser.newContext({
    baseURL: baseUrl(),
    locale: "en-US",
  });
  try {
    const accept = await context.request.post(
      `${baseUrl()}/api/workspace/invites/accept`,
      {
        data: {
          invitationId,
          token,
          name: "Templates and transclusion audit member",
          password,
        },
        headers: { Origin: baseUrl(), Referer: `${baseUrl()}/` },
      },
    );
    await parseResponse(accept);
    const me = await parseResponse<any>(
      await context.request.get(`${baseUrl()}/api/users/me`),
    );
    const userId = me.user.id as string;
    await apiPost(params.api, "/api/spaces/members/add", {
      spaceId: params.spaceId,
      role: params.role ?? "writer",
      userIds: [userId],
      groupIds: [],
    });

    const csrfToken = (await context.cookies()).find(
      (cookie) => cookie.name === "csrfToken",
    )?.value;
    if (!csrfToken) throw new Error("Audit member CSRF cookie is missing");
    return wrapAuditMember(context, userId, csrfToken, false);
  } catch (error) {
    await context.close();
    throw error;
  }
}

export async function removeAuditMember(
  api: APIRequestContext,
  member: AuditMember | undefined,
): Promise<void> {
  if (!member) return;
  await member.context.close().catch(() => undefined);
  if (member.managedByRunner) return;
  await apiPost(api, "/api/workspace/members/delete", {
    userId: member.userId,
  }).catch(() => undefined);
}
