import type { BrowserContext } from "@playwright/test";

export function requiredSecret(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required and must be supplied at runtime`);
  }
  return value;
}

export function baseUrl(): string {
  return (process.env.DOCMOST_BASE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

export function apiBaseUrl(): string {
  return (process.env.DOCMOST_API_BASE_URL ?? baseUrl()).replace(/\/$/, "");
}

export function apiOrigin(): string {
  return (process.env.DOCMOST_API_ORIGIN ?? baseUrl()).replace(/\/$/, "");
}

export async function authenticateAdminContext(
  context: BrowserContext,
): Promise<void> {
  const urls = [
    baseUrl(),
    process.env.DOCMOST_WEBKIT_BASE_URL ?? baseUrl(),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value));
  const uniqueUrls = Array.from(
    new Map(urls.map((url) => [url.hostname, url])).values(),
  );
  await context.addCookies(
    uniqueUrls.flatMap((url) => [
      {
        name: "authToken",
        value: requiredSecret("DOCMOST_AUTH_TOKEN"),
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax" as const,
        secure: url.protocol === "https:",
      },
      {
        name: "csrfToken",
        value: requiredSecret("DOCMOST_CSRF_TOKEN"),
        domain: url.hostname,
        path: "/",
        httpOnly: false,
        sameSite: "Lax" as const,
        secure: url.protocol === "https:",
      },
    ]),
  );
}
