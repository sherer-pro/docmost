import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import { getCollabTokenRetryDelay, shouldRetryCollabToken } from "./auth-query";

describe("collaboration token retry policy", () => {
  it("handles network errors without an HTTP response", () => {
    const networkError = new AxiosError("network");

    expect(() => shouldRetryCollabToken(0, networkError)).not.toThrow();
    expect(shouldRetryCollabToken(0, networkError)).toBe(true);
  });

  it("does not retry a missing token endpoint", () => {
    const notFound = new AxiosError(
      "not found",
      undefined,
      undefined,
      undefined,
      { status: 404 } as never,
    );

    expect(shouldRetryCollabToken(0, notFound)).toBe(false);
  });

  it("stops after ten retries", () => {
    const networkError = new AxiosError("network");

    expect(shouldRetryCollabToken(9, networkError)).toBe(true);
    expect(shouldRetryCollabToken(10, networkError)).toBe(false);
  });

  it("uses capped exponential delays", () => {
    expect(getCollabTokenRetryDelay(0)).toBe(5_000);
    expect(getCollabTokenRetryDelay(1)).toBe(10_000);
    expect(getCollabTokenRetryDelay(4)).toBe(60_000);
    expect(getCollabTokenRetryDelay(20)).toBe(60_000);
  });
});
