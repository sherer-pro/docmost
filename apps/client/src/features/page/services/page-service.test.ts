import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyPageMarkdownWithComments,
  getAllSidebarPages,
  getSidebarPages,
  uploadFile,
} from "./page-service";

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  default: {
    get: getMock,
    post: postMock,
  },
  unwrapApiResponse: (value: unknown) => {
    if (
      typeof value === "object" &&
      value !== null &&
      "data" in value &&
      "success" in value &&
      "status" in value
    ) {
      return (value as { data: unknown }).data;
    }

    return value;
  },
}));

describe("page-service sidebar reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the canonical GET sidebar route", async () => {
    const params = {
      spaceId: "space-id",
      includeNodeTypes: ["page" as const, "database" as const],
    };
    getMock.mockResolvedValue({
      data: {
        items: [],
        meta: {},
      },
    });

    await expect(getSidebarPages(params)).resolves.toEqual({
      items: [],
      meta: {},
    });

    expect(getMock).toHaveBeenCalledWith(
      "/pages/sidebar-pages",
      expect.objectContaining({ params }),
    );

    const requestConfig = getMock.mock.calls[0][1];
    expect(requestConfig.paramsSerializer.serialize(params)).toBe(
      "spaceId=space-id&includeNodeTypes=page&includeNodeTypes=database",
    );
    expect(postMock).not.toHaveBeenCalledWith(
      "/pages/sidebar-pages",
      expect.anything(),
    );
  });

  it("paginates all sidebar pages through the canonical GET route", async () => {
    getMock
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "page-1" }],
          meta: { nextCursor: "cursor-2" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: "page-2" }],
          meta: { nextCursor: null },
        },
      });

    await expect(getAllSidebarPages({ spaceId: "space-id" })).resolves.toEqual({
      pageParams: [undefined, "cursor-2"],
      pages: [
        { items: [{ id: "page-1" }], meta: { nextCursor: "cursor-2" } },
        { items: [{ id: "page-2" }], meta: { nextCursor: null } },
      ],
    });

    expect(getMock).toHaveBeenNthCalledWith(
      1,
      "/pages/sidebar-pages",
      expect.objectContaining({
        params: { spaceId: "space-id", cursor: undefined },
      }),
    );
    expect(getMock).toHaveBeenNthCalledWith(
      2,
      "/pages/sidebar-pages",
      expect.objectContaining({
        params: { spaceId: "space-id", cursor: "cursor-2" },
      }),
    );

    expect(getMock.mock.calls[0][1].paramsSerializer.serialize({ spaceId: "space-id" })).toBe(
      "spaceId=space-id",
    );
    expect(
      getMock.mock.calls[1][1].paramsSerializer.serialize({
        spaceId: "space-id",
        cursor: "cursor-2",
      }),
    ).toBe("spaceId=space-id&cursor=cursor-2");
  });
});

describe("page-service copyPageMarkdownWithComments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests markdown with comments for a page", async () => {
    postMock.mockResolvedValue({
      data: {
        markdown: "# Page\n\nBody\n\n---\n\n## Comments",
      },
    });

    await expect(copyPageMarkdownWithComments("page-1")).resolves.toBe(
      "# Page\n\nBody\n\n---\n\n## Comments",
    );
    expect(postMock).toHaveBeenCalledWith(
      "/pages/actions/copy-markdown-with-comments",
      { pageId: "page-1" },
    );
  });
});

describe("page-service uploadFile", () => {
  const attachment = {
    id: "attachment-id",
    fileName: "diagram.drawio.svg",
    filePath: "workspace-id/files/attachment-id/diagram.drawio.svg",
    fileSize: 1135,
    fileExt: ".svg",
    mimeType: "image/svg+xml",
    type: "file",
    creatorId: "user-id",
    pageId: "page-id",
    spaceId: "space-id",
    workspaceId: "workspace-id",
    createdAt: "2026-06-18T12:53:32.992Z",
    updatedAt: "2026-06-18T12:53:32.992Z",
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns raw attachment responses from multipart upload endpoints", async () => {
    postMock.mockResolvedValue(attachment);

    const file = new File(["<svg></svg>"], "diagram.drawio.svg", {
      type: "image/svg+xml",
    });

    await expect(uploadFile(file, "page-id")).resolves.toBe(attachment);

    expect(postMock).toHaveBeenCalledWith(
      "/attachments/actions/upload-file",
      expect.any(FormData),
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      },
    );
    const formData = postMock.mock.calls[0][1] as FormData;
    expect(formData.get("pageId")).toBe("page-id");
    expect(formData.get("file")).toBe(file);
  });

  it("still supports wrapped attachment responses", async () => {
    postMock.mockResolvedValue({
      data: attachment,
      success: true,
      status: 200,
    });

    const file = new File(["<svg></svg>"], "diagram.drawio.svg", {
      type: "image/svg+xml",
    });

    await expect(uploadFile(file, "page-id", "attachment-id")).resolves.toBe(
      attachment,
    );

    const formData = postMock.mock.calls[0][1] as FormData;
    expect(formData.get("attachmentId")).toBe("attachment-id");
  });
});
