import api from "@/lib/api-client";
import { ISession } from "@/features/session/types/session.types";

type SessionListResponse = {
  sessions: ISession[];
};

function unwrapSessionList(value: unknown): SessionListResponse {
  const response = value as { data?: SessionListResponse } & SessionListResponse;
  return response.data ?? response;
}

export async function getSessions(): Promise<ISession[]> {
  const req = await api.post<SessionListResponse>("/sessions");
  return unwrapSessionList(req).sessions;
}

export async function revokeSession(data: {
  sessionId: string;
}): Promise<void> {
  await api.post("/sessions/revoke", data);
}

export async function revokeAllSessions(): Promise<void> {
  await api.post("/sessions/revoke-all");
}
