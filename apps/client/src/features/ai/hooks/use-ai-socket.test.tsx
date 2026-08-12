// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiSocket } from "./use-ai-socket";

const {
  socketAtom,
  documentAtom,
  runsAtom,
  activityAtom,
  unreadAtom,
  asideAtom,
  useAtomValueMock,
  useSetAtomMock,
  invalidateQueriesMock,
  setRunsMock,
  setActivityMock,
} = vi.hoisted(() => ({
  socketAtom: Symbol("socket"),
  documentAtom: Symbol("document"),
  runsAtom: Symbol("runs"),
  activityAtom: Symbol("activity"),
  unreadAtom: Symbol("unread"),
  asideAtom: Symbol("aside"),
  useAtomValueMock: vi.fn(),
  useSetAtomMock: vi.fn(),
  invalidateQueriesMock: vi.fn(),
  setRunsMock: vi.fn(),
  setActivityMock: vi.fn(),
}));

vi.mock("jotai", () => ({
  useAtomValue: useAtomValueMock,
  useSetAtom: useSetAtomMock,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
    setQueryData: vi.fn(),
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: {} }),
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

vi.mock("@/features/ai/queries/ai-query.ts", () => ({
  AI_QUERY_KEYS: {
    messages: (conversationId: string) => ["ai", "messages", conversationId],
    run: (runId: string) => ["ai", "run", runId],
    conversations: (pageId: string) => ["ai", "conversations", pageId],
    contentPolicy: (spaceId: string) => ["ai", "content-policy", spaceId],
  },
}));

vi.mock("@/features/ai/utils/ai-policies.ts", () => ({
  AI_RECONNECT_QUERY_KEY: ["ai"],
  resolveAiErrorMessage: () => "AI request failed",
}));

vi.mock("@/features/websocket/atoms/socket-atom.ts", () => ({ socketAtom }));
vi.mock("@/features/ai/atoms/ai-atoms.ts", () => ({
  aiDocumentContextAtom: documentAtom,
  aiStreamingRunsAtom: runsAtom,
  aiActivityAtom: activityAtom,
  aiUnreadRunsAtom: unreadAtom,
}));
vi.mock("@/components/layouts/global/hooks/atoms/sidebar-atom.ts", () => ({
  asideStateAtom: asideAtom,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = (...args: unknown[]) => void;

function createSocket(connected: boolean) {
  const listeners = new Map<string, Listener>();
  return {
    connected,
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: string) => {
      listeners.delete(event);
    }),
    emitLocal(event: string) {
      listeners.get(event)?.();
    },
  };
}

function SocketConsumer() {
  useAiSocket();
  return null;
}

describe("useAiSocket reconnect invalidation", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useSetAtomMock.mockImplementation((atom: symbol) => {
      if (atom === runsAtom) return setRunsMock;
      if (atom === activityAtom) return setActivityMock;
      return vi.fn();
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    vi.clearAllMocks();
  });

  it("does not invalidate all AI queries on the initial connection", () => {
    const socket = createSocket(false);
    useAtomValueMock.mockImplementation((atom: symbol) =>
      atom === socketAtom ? socket : null,
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<SocketConsumer />));
    act(() => socket.emitLocal("connect"));

    expect(invalidateQueriesMock).not.toHaveBeenCalled();
    expect(setRunsMock).not.toHaveBeenCalled();

    act(() => socket.emitLocal("connect"));

    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ["ai"] });
    expect(setRunsMock).toHaveBeenCalledOnce();
    expect(setActivityMock).toHaveBeenCalledOnce();
  });
});
