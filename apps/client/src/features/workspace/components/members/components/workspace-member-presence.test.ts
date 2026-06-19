import { describe, expect, it } from "vitest";
import {
  getMemberPresenceSummary,
  shouldFetchWorkspaceMemberPresence,
} from "./workspace-member-presence-utils";
import { MemberPresence } from "@/features/workspace/types/workspace.types";

const t = (key: string, options?: Record<string, unknown>) =>
  key.replace("{{count}}", String(options?.count ?? ""));

describe("workspace member presence UI helpers", () => {
  it("renders offline summary when presence is missing", () => {
    expect(getMemberPresenceSummary(undefined, t)).toBe("Offline");
  });

  it("renders single-session online summary", () => {
    const presence: MemberPresence = {
      isOnline: true,
      lastSeenAt: "2026-06-19T10:00:00.000Z",
      sessions: [
        {
          sessionKey: "session-1",
          sessionId: "session-1",
          isLegacy: false,
          deviceName: "Chrome on Windows",
          lastSeenAt: "2026-06-19T10:00:00.000Z",
          locations: [],
        },
      ],
    };

    expect(getMemberPresenceSummary(presence, t)).toBe("Online · 1 session");
  });

  it("renders multi-session online summary", () => {
    const presence: MemberPresence = {
      isOnline: true,
      lastSeenAt: "2026-06-19T10:00:00.000Z",
      sessions: [
        {
          sessionKey: "session-1",
          sessionId: "session-1",
          isLegacy: false,
          deviceName: "Chrome on Windows",
          lastSeenAt: "2026-06-19T10:00:00.000Z",
          locations: [],
        },
        {
          sessionKey: "session-2",
          sessionId: "session-2",
          isLegacy: false,
          deviceName: "Firefox on Linux",
          lastSeenAt: "2026-06-19T10:00:00.000Z",
          locations: [],
        },
      ],
    };

    expect(getMemberPresenceSummary(presence, t)).toBe("Online · 2 sessions");
  });

  it("enables presence fetching only for admins with visible users", () => {
    expect(shouldFetchWorkspaceMemberPresence(true, ["user-1"])).toBe(true);
    expect(shouldFetchWorkspaceMemberPresence(false, ["user-1"])).toBe(false);
    expect(shouldFetchWorkspaceMemberPresence(true, [])).toBe(false);
  });
});
