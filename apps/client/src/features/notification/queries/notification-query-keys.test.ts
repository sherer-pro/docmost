import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";
import {
  invalidateNotificationQueries,
  NOTIFICATION_KEY,
  UNREAD_COUNT_KEY,
} from "./notification-query-keys";

describe("invalidateNotificationQueries", () => {
  it("invalidates both notifications list and unread counter", async () => {
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    };

    await invalidateNotificationQueries(queryClient);

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: NOTIFICATION_KEY,
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: UNREAD_COUNT_KEY,
    });
    assert.equal(queryClient.invalidateQueries.mock.calls.length, 2);
  });
});
