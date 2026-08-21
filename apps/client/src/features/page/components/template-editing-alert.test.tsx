// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TemplateRevision,
  TemplateSyncRun,
  TemplateSyncRunStatus,
} from "@/features/page-template/types/page-template.types";
import { TemplateEditingAlert } from "./template-editing-alert";

const mocks = vi.hoisted(() => {
  const editorListeners = new Set<() => void>();
  return {
    editorAtom: {},
    unsyncedAtom: {},
    editorListeners,
    editor: {
      getJSON: vi.fn(() => ({ type: "doc", content: [] })),
      on: vi.fn((_event: string, listener: () => void) => {
        editorListeners.add(listener);
      }),
      off: vi.fn((_event: string, listener: () => void) => {
        editorListeners.delete(listener);
      }),
    },
    unsynced: 0,
    getRevisions: vi.fn(),
    getRuns: vi.fn(),
    getUsages: vi.fn(),
    preflight: vi.fn(),
    publish: vi.fn(),
    retry: vi.fn(),
    hash: vi.fn(),
    notify: vi.fn(),
  };
});

vi.mock("@mantine/core", () => {
  const Wrapper = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Paper = ({
    children,
    component: Component = "div",
    ...props
  }: {
    children?: React.ReactNode;
    component?: React.ElementType;
    [key: string]: unknown;
  }) => {
    const { withBorder, radius, px, py, p, mb, mt, ...domProps } = props;
    void withBorder;
    void radius;
    void px;
    void py;
    void p;
    void mb;
    void mt;
    return <Component {...domProps}>{children}</Component>;
  };
  const Button = ({
    children,
    leftSection,
    loading,
    size,
    variant,
    color,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    leftSection?: React.ReactNode;
    loading?: boolean;
    size?: string;
    variant?: string;
    color?: string;
  }) => {
    void loading;
    void size;
    void variant;
    void color;
    return (
      <button type="button" {...props}>
        {leftSection}
        {children}
      </button>
    );
  };
  const Checkbox = ({
    checked,
    onChange,
    label,
  }: {
    checked: boolean;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    label: React.ReactNode;
  }) => (
    <label>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
  const Modal = ({
    opened,
    title,
    children,
  }: {
    opened: boolean;
    title?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    opened ? (
      <div role="dialog">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null;
  const Tooltip = ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  );
  return {
    Alert: Wrapper,
    Badge: ({ children, leftSection }: any) => (
      <span>
        {leftSection}
        {children}
      </span>
    ),
    Button,
    Checkbox,
    Group: Wrapper,
    Loader: () => <span>loading</span>,
    Modal,
    Paper,
    Progress: ({ value }: { value: number }) => (
      <progress value={value} max={100} />
    ),
    ScrollArea: { Autosize: Wrapper },
    SimpleGrid: Wrapper,
    Stack: Wrapper,
    Text: Wrapper,
    Tooltip,
  };
});

vi.mock("@tabler/icons-react", () => ({
  IconAlertTriangle: () => null,
  IconArrowLeft: () => null,
  IconCheck: () => null,
  IconClock: () => null,
  IconHistory: () => null,
  IconRefresh: () => null,
  IconSend: () => null,
  IconTemplate: () => null,
}));

vi.mock("@mantine/notifications", () => ({
  notifications: { show: mocks.notify },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en-US" },
    t: (key: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (result, [name, value]) => result.replace(`{{${name}}}`, String(value)),
        key,
      ),
  }),
}));

vi.mock("jotai", () => ({
  useAtomValue: (atom: unknown) =>
    atom === mocks.editorAtom ? mocks.editor : mocks.unsynced,
}));

vi.mock("@/features/editor/atoms/editor-atoms", () => ({
  pageEditorAtom: mocks.editorAtom,
  pageEditorUnsyncedChangesAtom: mocks.unsyncedAtom,
}));

vi.mock("@/features/page-template/services/page-template-api", () => ({
  getPageTemplateRevisions: mocks.getRevisions,
  getPageTemplateSyncRuns: mocks.getRuns,
  getPageTemplateUsages: mocks.getUsages,
  preflightPageTemplatePublish: mocks.preflight,
  publishPageTemplate: mocks.publish,
  retryPageTemplateSyncRun: mocks.retry,
  isCollaborationUnavailable: (error: any) =>
    error?.response?.data?.code === "collaboration_unavailable" ||
    error?.response?.status === 503,
}));

vi.mock("@/features/page-template/services/page-template-draft-hash", () => ({
  hashNormalizedTemplateDraft: mocks.hash,
}));

vi.mock("@docmost/editor-ext", () => ({
  summarizeTemplateDiff: () => ({
    addedBlockIds: [],
    removedBlockIds: [],
    movedBlockIds: [],
    changedBlockIds: [],
    addedFields: [],
    removedFields: [],
    renamedFields: [],
  }),
}));

vi.mock("./template-revision-preview", () => ({
  TemplateRevisionPreview: ({ label }: { label?: string }) => (
    <div role="region" aria-label={label} />
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("TemplateEditingAlert", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editorListeners.clear();
    mocks.unsynced = 0;
    mocks.getRevisions.mockResolvedValue({ items: [revision(2), revision(1)] });
    mocks.getRuns.mockResolvedValue({ items: [run("completed")] });
    mocks.getUsages.mockResolvedValue({ totalCount: 4, items: [] });
    mocks.hash.mockResolvedValue("hash-2");
    mocks.publish.mockResolvedValue({
      revision: revision(3),
      syncRun: run("pending"),
    });
    mocks.preflight.mockResolvedValue({
      draftHash: "draft-hash",
      nextRevision: 3,
      diff: {
        addedBlockIds: ["block-1"],
        removedBlockIds: [],
        movedBlockIds: [],
        changedBlockIds: ["block-2"],
        addedFields: [
          { fieldId: "field-1", label: "Owner", placeholder: "Name" },
        ],
        removedFields: [],
        renamedFields: [],
      },
      activeInstanceCount: 4,
      filledRemovedFieldInstanceCount: 0,
      filledRemovedFieldInstanceCountExact: true,
      requiresDestructiveConfirmation: false,
      confirmationToken: null,
      confirmationExpiresAt: null,
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  function render(editable = true) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <TemplateEditingAlert
          pageId="template-1"
          kind="synced"
          editable={editable}
        />,
      );
    });
  }

  it("polls queued work until the run becomes terminal", async () => {
    vi.useFakeTimers();
    mocks.getRuns
      .mockResolvedValueOnce({ items: [run("pending")] })
      .mockResolvedValueOnce({ items: [run("pending")] })
      .mockResolvedValue({ items: [run("completed")] });
    render();
    await flush();
    expect(container?.textContent).toContain("Queued");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(mocks.getRuns).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Queued");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(mocks.getRuns).toHaveBeenCalledTimes(3);
    expect(container?.textContent).toContain("Saved");
    expect(container?.textContent).toContain("No draft changes to publish.");
    expect(findButton("Review and publish")?.disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.getRuns).toHaveBeenCalledTimes(3);
    expect(mocks.getRevisions).toHaveBeenCalledTimes(1);
    expect(mocks.getUsages).toHaveBeenCalledTimes(1);
  });

  it("recovers a run-only polling error without reloading full metadata", async () => {
    vi.useFakeTimers();
    mocks.getRuns
      .mockResolvedValueOnce({ items: [run("pending")] })
      .mockRejectedValueOnce(new Error("runs unavailable"))
      .mockResolvedValue({ items: [run("completed")] });
    render();
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(container?.textContent).toContain("Update failed");
    expect(findButton("Retry")).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(container?.textContent).toContain("Saved");
    expect(findButton("Retry")).toBeUndefined();
    expect(mocks.getRevisions).toHaveBeenCalledTimes(1);
    expect(mocks.getUsages).toHaveBeenCalledTimes(1);
  });

  it("keeps full metadata recovery visible after a successful run-only poll", async () => {
    vi.useFakeTimers();
    mocks.hash.mockResolvedValue("changed-draft-hash");
    mocks.getRevisions
      .mockResolvedValueOnce({ items: [revision(2), revision(1)] })
      .mockRejectedValueOnce(new Error("revision metadata unavailable"));
    mocks.getRuns
      .mockResolvedValueOnce({ items: [run("completed")] })
      .mockResolvedValueOnce({ items: [run("pending")] })
      .mockResolvedValueOnce({ items: [run("completed")] });
    render();
    await flush();
    await act(async () => findButton("Review and publish")?.click());
    await act(async () => {
      findButton("Publish version 3")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(findButton("Retry")).toBeDefined();
    expect(mocks.notify).toHaveBeenCalledWith({
      message: "Template version 3 published.",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(findButton("Retry")).toBeDefined();
    expect(container?.textContent).toContain("Update failed");
    expect(mocks.getRevisions).toHaveBeenCalledTimes(2);
    expect(mocks.getUsages).toHaveBeenCalledTimes(2);
  });

  it("shows metadata failure with an inline retry recovery", async () => {
    mocks.getRevisions
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ items: [revision(2)] });
    render();
    await flush();
    expect(container?.textContent).toContain("Update failed");

    const retry = findButton("Retry");
    await act(async () => retry?.click());
    expect(mocks.getRevisions).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Saved");
  });

  it("does not request manager-only metadata for a read-only template", async () => {
    render(false);
    await flush();

    expect(mocks.getRevisions).not.toHaveBeenCalled();
    expect(mocks.getRuns).not.toHaveBeenCalled();
    expect(mocks.getUsages).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(container?.textContent).toContain("Read only");
    expect(findButton("History")).toBeUndefined();
    expect(findButton("Retry")).toBeUndefined();
    expect(findButton("Review and publish")).toBeUndefined();
  });

  it("explains why publishing is disabled while editor changes are unsaved", async () => {
    mocks.unsynced = 1;
    render();
    await flush();

    expect(container?.textContent).toContain("Draft changes");
    expect(container?.textContent).toContain(
      "Wait until your changes are saved before publishing.",
    );
    expect(findButton("Review and publish")?.disabled).toBe(true);
  });

  it("recalculates draft status after a remote update while unsynced stays zero", async () => {
    mocks.hash
      .mockResolvedValueOnce("hash-2")
      .mockResolvedValue("remote-draft-hash");
    render();
    await flush();
    expect(container?.textContent).toContain("Saved");
    expect(findButton("Review and publish")?.disabled).toBe(true);

    act(() => {
      mocks.editorListeners.forEach((listener) => listener());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 175));
    });
    await flush();

    expect(mocks.hash).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Draft changes");
    expect(findButton("Review and publish")?.disabled).toBe(false);
  });

  it("shows block and field impact in the publication preflight", async () => {
    mocks.hash.mockResolvedValue("changed-draft-hash");
    render();
    await flush();
    await act(async () => findButton("Review and publish")?.click());

    expect(container?.textContent).toContain("Shared content");
    expect(container?.textContent).toContain("Editable fields");
    expect(container?.textContent).toContain("Owner");
  });

  it("keeps draft state and retries preflight after collaboration is unavailable", async () => {
    mocks.hash.mockResolvedValue("changed-draft-hash");
    mocks.preflight
      .mockRejectedValueOnce({
        response: {
          status: 503,
          data: { code: "collaboration_unavailable" },
        },
      })
      .mockResolvedValueOnce({
        draftHash: "draft-hash",
        nextRevision: 3,
        diff: {
          addedBlockIds: ["block-1"],
          removedBlockIds: [],
          movedBlockIds: [],
          changedBlockIds: [],
          addedFields: [],
          removedFields: [],
          renamedFields: [],
        },
        activeInstanceCount: 4,
        filledRemovedFieldInstanceCount: 0,
        filledRemovedFieldInstanceCountExact: true,
        requiresDestructiveConfirmation: false,
        confirmationToken: null,
        confirmationExpiresAt: null,
      });
    render();
    await flush();
    await act(async () => findButton("Review and publish")?.click());

    expect(container?.textContent).toContain(
      "Live editing is temporarily unavailable. Your input is preserved. Try again.",
    );
    expect(container?.textContent).toContain("Draft changes");

    await act(async () => findButton("Retry")?.click());

    expect(mocks.preflight).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Shared content");
  });

  it("labels a bounded destructive scan as an upper bound", async () => {
    mocks.hash.mockResolvedValue("changed-draft-hash");
    mocks.preflight.mockResolvedValueOnce({
      draftHash: "draft-hash",
      nextRevision: 3,
      diff: {
        addedBlockIds: [],
        removedBlockIds: [],
        movedBlockIds: [],
        changedBlockIds: [],
        addedFields: [],
        removedFields: [
          { fieldId: "field-1", label: "Owner", placeholder: "Name" },
        ],
        renamedFields: [],
      },
      activeInstanceCount: 400,
      filledRemovedFieldInstanceCount: 301,
      filledRemovedFieldInstanceCountExact: false,
      requiresDestructiveConfirmation: true,
      confirmationToken: "confirmation",
      confirmationExpiresAt: "2026-08-14T12:00:00.000Z",
    });
    render();
    await flush();
    await act(async () => findButton("Review and publish")?.click());

    expect(container?.textContent).toContain(
      "Up to 301 linked pages may contain values that will be permanently deleted. Not every page could be checked.",
    );
    expect(container?.textContent).not.toContain(
      "Values on 301 linked pages will be permanently deleted.",
    );
  });

  it("reruns preflight after the draft changes during publication", async () => {
    mocks.hash.mockResolvedValue("changed-draft-hash");
    mocks.publish.mockRejectedValueOnce({
      response: { data: { code: "page_template_draft_changed" } },
    });
    render();
    await flush();
    await act(async () => findButton("Review and publish")?.click());

    await act(async () => {
      findButton("Publish version 3")?.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(mocks.preflight).toHaveBeenCalledTimes(2);
    expect(container?.textContent).toContain("Shared content");
  });

  it("replaces history content with comparison instead of nesting a modal", async () => {
    render();
    await flush();
    await act(async () => findButton("History")?.click());
    await act(async () => findButton("View and compare")?.click());

    expect(container?.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(container?.textContent).toContain("Back");
    expect(container?.querySelector('[aria-label="Version 2"]')).not.toBeNull();
  });

  it("does not offer retry for a superseded historical run", async () => {
    mocks.getRuns.mockResolvedValue({
      items: [
        { ...run("completed"), id: "latest-run", revision: 2 },
        {
          ...run("failed"),
          id: "historical-run",
          revision: 1,
          failedCount: 1,
        },
      ],
    });
    render();
    await flush();
    await act(async () => findButton("History")?.click());

    expect(findButton("Retry failed pages")).toBeUndefined();
  });

  it("retries only the latest failed run and polls it to a terminal state", async () => {
    vi.useFakeTimers();
    const failedRun = {
      ...run("failed"),
      id: "latest-run",
      failedCount: 1,
    };
    mocks.getRuns
      .mockResolvedValueOnce({ items: [failedRun] })
      .mockResolvedValueOnce({ items: [failedRun] })
      .mockResolvedValueOnce({
        items: [{ ...run("pending"), id: "latest-run" }],
      })
      .mockResolvedValueOnce({
        items: [{ ...run("completed"), id: "latest-run" }],
      });
    render();
    await flush();
    await act(async () => findButton("History")?.click());

    await act(async () => {
      findButton("Retry failed pages")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.retry).toHaveBeenCalledWith("template-1", "latest-run");
    expect(container?.textContent).toContain("Queued");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });

    expect(mocks.getRuns).toHaveBeenCalledTimes(4);
    expect(findButton("Retry failed pages")).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(mocks.getRuns).toHaveBeenCalledTimes(4);
  });

  it("labels a page-boundary revision as view-only until its neighbor loads", async () => {
    const boundaryPage = {
      items: [revision(2)],
      nextCursor: "older-revisions",
    };
    mocks.getRevisions
      .mockResolvedValueOnce(boundaryPage)
      .mockResolvedValueOnce(boundaryPage)
      .mockResolvedValueOnce({ items: [revision(1)], nextCursor: null });
    render();
    await flush();
    await act(async () => findButton("History")?.click());

    expect(findButtonExact("View and compare")).toBeUndefined();
    expect(findButtonExact("View")).toBeDefined();
    expect(findButton("Load more")).toBeDefined();

    await act(async () => findButton("Load more")?.click());

    expect(findButtonExact("View and compare")).toBeDefined();
    expect(findButtonExact("View")).toBeDefined();
    expect(findButton("Load more")).toBeUndefined();

    await act(async () => findButtonExact("View and compare")?.click());
    expect(container?.querySelector('[aria-label="Version 2"]')).not.toBeNull();
    expect(container?.querySelector('[aria-label="Version 1"]')).not.toBeNull();
  });

  function findButton(label: string) {
    return Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.includes(label),
    );
  }

  function findButtonExact(label: string) {
    return Array.from(container?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === label,
    );
  }
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function revision(number: number): TemplateRevision & { content: unknown } {
  return {
    id: `revision-${number}`,
    templatePageId: "template-1",
    revision: number,
    contentHash: `hash-${number}`,
    publishedById: null,
    createdAt: new Date(number * 1_000).toISOString(),
    content: { type: "doc", content: [] },
  };
}

function run(status: TemplateSyncRunStatus): TemplateSyncRun {
  return {
    id: `run-${status}`,
    templatePageId: "template-1",
    revision: 2,
    status,
    totalCount: 4,
    processedCount: status === "pending" ? 0 : 4,
    succeededCount: status === "completed" ? 4 : 0,
    failedCount: 0,
    errorCode: null,
    startedAt: null,
    completedAt: status === "completed" ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  };
}
