import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf8");
const registrationSource = readFileSync(
  resolve(process.cwd(), "src", "lib", "pwa", "register-service-worker.ts"),
  "utf8",
);

describe("service worker safety policy", () => {
  it("cleans partial shell installs and obsolete Docmost caches", () => {
    expect(source).toContain("await caches.delete(SHELL_CACHE)");
    expect(source).toContain("!CURRENT_CACHES.has(cacheName)");
    expect(source).toContain("cacheName.startsWith(CACHE_PREFIX)");
  });

  it("validates cached navigation documents and includes the offline locale script", () => {
    expect(source).toContain("isValidDocumentResponse(cachedResponse)");
    expect(source).toContain("html.includes('id=\"root\"')");
    expect(source).toContain('"/offline.js"');
  });

  it("keeps private API and collaboration traffic out of caches", () => {
    expect(source).toContain('url.pathname.startsWith("/api")');
    expect(source).toContain('url.pathname.startsWith("/socket.io")');
    expect(source).toContain('url.pathname.startsWith("/collab")');
  });

  it("registers even when the window load event has already fired", () => {
    expect(registrationSource).toContain('document.readyState === "complete"');
    expect(registrationSource).toContain("{ once: true }");
  });
});
