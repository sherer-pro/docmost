import { describe, expect, it } from "vitest";
import { safeQueryRetryDelay, shouldRetrySafeQuery } from "./safe-query-retry";

describe("safe query retry", () => {
  it("retries network and 5xx failures at most twice", () => {
    expect(shouldRetrySafeQuery(0, new Error("network"))).toBe(true);
    expect(shouldRetrySafeQuery(1, { response: { status: 503 } })).toBe(true);
    expect(shouldRetrySafeQuery(2, { response: { status: 503 } })).toBe(false);
  });

  it("never retries 4xx responses", () => {
    expect(shouldRetrySafeQuery(0, { response: { status: 401 } })).toBe(false);
    expect(shouldRetrySafeQuery(0, { response: { status: 404 } })).toBe(false);
    expect(shouldRetrySafeQuery(0, { response: { status: 600 } })).toBe(false);
  });

  it("uses a short bounded backoff", () => {
    expect(safeQueryRetryDelay(0)).toBe(500);
    expect(safeQueryRetryDelay(1)).toBe(1_000);
    expect(safeQueryRetryDelay(10)).toBe(2_000);
  });
});
