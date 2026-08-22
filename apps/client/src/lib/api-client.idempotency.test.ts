// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquireIdempotencyLease,
  runWithIdempotencyLease,
} from "./api-client";

describe("idempotency lease", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists only a hashed fingerprint and reuses the key after failure", async () => {
    const payload = {
      title: "Private title",
      confirmationToken: "secret-confirmation",
    };
    const failedOperation = vi.fn().mockRejectedValue(new Error("network"));

    await expect(
      runWithIdempotencyLease({
        scope: "/pages/templates/actions/create",
        payload,
        operation: failedOperation,
      }),
    ).rejects.toThrow("network");

    const storageKey = sessionStorage.key(0);
    expect(storageKey).toMatch(/^docmost:idempotency:v1:[a-f0-9]{64}$/u);
    expect(storageKey).not.toContain(payload.title);
    expect(storageKey).not.toContain(payload.confirmationToken);

    const retry = vi.fn().mockResolvedValue("ok");
    await expect(
      runWithIdempotencyLease({
        scope: "/pages/templates/actions/create",
        payload: {
          confirmationToken: "secret-confirmation",
          title: "Private title",
        },
        operation: retry,
      }),
    ).resolves.toBe("ok");

    expect(retry.mock.calls[0][0]).toBe(failedOperation.mock.calls[0][0]);
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps an unknown-outcome lease until explicit cancellation", async () => {
    const first = await acquireIdempotencyLease("scope", { value: 1 });
    const recovered = await acquireIdempotencyLease("scope", { value: 1 });
    expect(recovered.idempotencyKey).toBe(first.idempotencyKey);

    recovered.cancel();
    expect(sessionStorage.length).toBe(0);
    const next = await acquireIdempotencyLease("scope", { value: 1 });
    expect(next.idempotencyKey).not.toBe(recovered.idempotencyKey);
    next.complete();
  });

  it("rotates a key after the server proves that it was reused", async () => {
    const firstError = {
      response: { data: { code: "idempotency_key_reused" } },
    };
    const first = vi.fn().mockRejectedValue(firstError);
    await expect(
      runWithIdempotencyLease({
        scope: "scope",
        payload: { value: 1 },
        operation: first,
      }),
    ).rejects.toBe(firstError);

    const retry = vi.fn().mockResolvedValue("ok");
    await runWithIdempotencyLease({
      scope: "scope",
      payload: { value: 1 },
      operation: retry,
    });
    expect(retry.mock.calls[0][0]).not.toBe(first.mock.calls[0][0]);
  });

  it("one-flights concurrent operations with the same fingerprint", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => {
      resolve = done;
    });
    const operation = vi.fn(() => pending);
    const input = { scope: "concurrent", payload: { value: 1 }, operation };

    const first = runWithIdempotencyLease(input);
    const second = runWithIdempotencyLease(input);
    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));

    resolve("done");
    await expect(Promise.all([first, second])).resolves.toEqual([
      "done",
      "done",
    ]);
  });
});
