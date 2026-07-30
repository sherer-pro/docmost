// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAiAssistantIdentity } from "./use-ai-assistant-identity";

const { useAiSpaceStatusQueryMock, useAtomValueMock } = vi.hoisted(() => ({
  useAiSpaceStatusQueryMock: vi.fn(),
  useAtomValueMock: vi.fn(),
}));

vi.mock("jotai", () => ({
  useAtomValue: useAtomValueMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

vi.mock("@/features/ai/atoms/ai-atoms.ts", () => ({
  aiDocumentContextAtom: Symbol("aiDocumentContextAtom"),
}));

vi.mock("@/features/ai/queries/ai-query.ts", () => ({
  useAiSpaceStatusQuery: useAiSpaceStatusQueryMock,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function IdentityConsumer() {
  const identity = useAiAssistantIdentity();
  return <span>{identity.name}</span>;
}

describe("useAiAssistantIdentity", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    useAiSpaceStatusQueryMock.mockReturnValue({ data: undefined });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    useAiSpaceStatusQueryMock.mockReset();
    useAtomValueMock.mockReset();
  });

  it("does not read pageId before document context is available", () => {
    useAtomValueMock.mockReturnValue(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    expect(() => {
      act(() => root?.render(<IdentityConsumer />));
    }).not.toThrow();

    expect(useAiSpaceStatusQueryMock).toHaveBeenCalledWith(
      undefined,
      undefined,
    );
    expect(container.textContent).toBe("ai.title");
  });

  it("uses the current document page for the matching space", () => {
    useAtomValueMock.mockReturnValue({
      pageId: "page-id",
      spaceId: "space-id",
      spaceSlug: "space-slug",
      title: "Page",
      canWrite: true,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<IdentityConsumer />));

    expect(useAiSpaceStatusQueryMock).toHaveBeenCalledWith(
      "space-id",
      "page-id",
    );
  });
});
