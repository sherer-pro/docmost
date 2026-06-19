import { MemberPresence } from "@/features/workspace/types/workspace.types";

export function shouldFetchWorkspaceMemberPresence(
  isAdmin: boolean,
  userIds: string[],
) {
  return isAdmin && userIds.length > 0;
}

export function getMemberPresenceSummary(
  presence: MemberPresence | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (!presence?.isOnline || presence.sessions.length === 0) {
    return t("Offline");
  }

  const sessionCount = presence.sessions.length;
  const sessionLabel =
    sessionCount === 1
      ? t("1 session")
      : t("{{count}} sessions", { count: sessionCount });

  return `${t("Online")} · ${sessionLabel}`;
}
