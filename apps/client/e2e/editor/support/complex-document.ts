import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  attachmentUrl,
  apiPostWithHeaders,
  buildSilentWav,
  buildTinyPdf,
  createPage,
  pseudoMp4,
  tinyPng,
  uniqueId,
  updatePageContent,
  uploadFixture,
} from "./api";
import type { AuditState, PageRecord } from "./types";

type JsonNode = Record<string, unknown>;

export interface SeededComplexDocument {
  page: PageRecord;
  childPage: PageRecord;
  sourcePage: PageRecord;
  sourceTransclusionId: string;
  expectedNodeTypes: string[];
  expectedMarkTypes: string[];
}

const text = (
  value: string,
  marks?: Array<Record<string, unknown>>,
): JsonNode => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

const paragraph = (...content: JsonNode[]): JsonNode => ({
  type: "paragraph",
  content,
});

async function mermaidFixture(name: string): Promise<string> {
  return fs.readFile(
    path.resolve(process.cwd(), `e2e/editor/fixtures/${name}`),
    "utf8",
  );
}

export async function seedComplexDocument(
  api: APIRequestContext,
  state: AuditState,
  browserName: string,
): Promise<SeededComplexDocument> {
  const sourceTransclusionId = uniqueId("transclusion");
  const { page: sourcePage } = await apiPostWithHeaders<{ page: PageRecord }>(
    api,
    "/api/pages/templates/actions/create",
    {
      spaceId: state.spaceId,
      kind: "regular",
      title: `${browserName} linked source`,
    },
    { "Idempotency-Key": randomUUID() },
  );
  await updatePageContent(api, sourcePage.id, {
    type: "doc",
    content: [
      {
        type: "transclusionSource",
        attrs: { id: sourceTransclusionId },
        content: [paragraph(text("Shared source content"))],
      },
    ],
  });
  const page = await createPage(
    api,
    state.spaceId,
    `${browserName} all editor nodes`,
  );
  const childPage = await createPage(
    api,
    state.spaceId,
    `${browserName} child navigation target`,
    {
      type: "doc",
      content: [
        paragraph(text("Child page used by the subpage navigation audit.")),
      ],
    },
    page.id,
  );

  const [image, audio, pdf, video, generic] = await Promise.all([
    uploadFixture(api, page.id, "audit-image.png", "image/png", tinyPng()),
    uploadFixture(
      api,
      page.id,
      "audit-audio.wav",
      "audio/wav",
      buildSilentWav(),
    ),
    uploadFixture(
      api,
      page.id,
      "audit-document.pdf",
      "application/pdf",
      buildTinyPdf(),
    ),
    uploadFixture(api, page.id, "audit-video.mp4", "video/mp4", pseudoMp4()),
    uploadFixture(
      api,
      page.id,
      "audit-note.txt",
      "text/plain",
      Buffer.from("safe local attachment\n"),
    ),
  ]);

  const validMermaid = await mermaidFixture("mermaid-valid.mmd");
  const invalidMermaid = await mermaidFixture("mermaid-invalid.mmd");
  const maliciousMermaid = await mermaidFixture("mermaid-malicious.mmd");
  const internalUrl = `/s/${state.spaceSlug}/p/${sourcePage.slugId}`;
  const allMarks = [
    text("bold", [{ type: "bold" }]),
    text(" italic", [{ type: "italic" }]),
    text(" underline", [{ type: "underline" }]),
    text(" strike", [{ type: "strike" }]),
    text(" code", [{ type: "code" }]),
    text(" superscript", [{ type: "superscript" }]),
    text(" subscript", [{ type: "subscript" }]),
    text(" highlight", [
      { type: "highlight", attrs: { color: "#fff3bf", colorName: "yellow" } },
    ]),
    text(" color", [{ type: "textStyle", attrs: { color: "#c92a2a" } }]),
    text(" external link", [
      {
        type: "link",
        attrs: { href: "https://example.com", target: "_blank" },
      },
    ]),
    text(" internal link", [{ type: "link", attrs: { href: internalUrl } }]),
    text(" comment", [
      {
        type: "comment",
        attrs: { commentId: uniqueId("comment"), resolved: false },
      },
    ]),
  ];
  const tableCell = (value: string, type = "tableCell") => ({
    type,
    content: [paragraph(text(value))],
  });

  const content: JsonNode = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, id: uniqueId("h1"), indent: 0 },
        content: [text("Editor regression audit")],
      },
      {
        type: "heading",
        attrs: { level: 2, id: uniqueId("h2"), indent: 1 },
        content: [text("Nested heading")],
      },
      {
        type: "heading",
        attrs: { level: 3, id: uniqueId("h3"), indent: 2 },
        content: [text("Deep heading")],
      },
      {
        type: "heading",
        attrs: { level: 2, id: uniqueId("h2-reset"), indent: 0 },
        content: [text("Reset branch")],
      },
      paragraph(...allMarks),
      {
        type: "paragraph",
        attrs: { indent: 2, textAlign: "center" },
        content: [text("Indented and centered paragraph")],
      },
      { type: "blockquote", content: [paragraph(text("Block quote"))] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph(text("Bullet item"))] },
        ],
      },
      {
        type: "orderedList",
        attrs: { start: 3 },
        content: [
          { type: "listItem", content: [paragraph(text("Ordered item"))] },
        ],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [paragraph(text("Completed task"))],
          },
        ],
      },
      { type: "horizontalRule" },
      paragraph(
        text("Before hard break"),
        { type: "hardBreak" } as JsonNode,
        text("After hard break"),
      ),
      {
        type: "details",
        attrs: { open: true },
        content: [
          { type: "detailsSummary", content: [text("Expandable details")] },
          {
            type: "detailsContent",
            content: [paragraph(text("Details body"))],
          },
        ],
      },
      {
        type: "callout",
        attrs: { type: "warning", icon: "alert-triangle" },
        content: [paragraph(text("Warning callout"))],
      },
      paragraph(text("Inline formula "), {
        type: "mathInline",
        attrs: { text: "E=mc^2" },
      }),
      { type: "mathBlock", attrs: { text: "\\int_0^1 x^2 dx" } },
      {
        type: "table",
        attrs: { widthMode: "full" },
        content: [
          {
            type: "tableRow",
            content: [
              tableCell("Header A", "tableHeader"),
              tableCell("Header B", "tableHeader"),
              tableCell("Header C", "tableHeader"),
            ],
          },
          {
            type: "tableRow",
            content: [
              tableCell("Merge and resize target"),
              tableCell("Wide content ".repeat(24)),
              tableCell("Third column"),
            ],
          },
          {
            type: "tableRow",
            content: [
              tableCell("Row 3 A"),
              tableCell("Row 3 B"),
              tableCell("Row 3 C"),
            ],
          },
        ],
      },
      { type: "pageBreak" },
      {
        type: "image",
        attrs: {
          src: attachmentUrl(image),
          attachmentId: image.id,
          size: image.fileSize,
          width: "60%",
          align: "center",
          alt: "Editor audit image alt text",
          title: "Editor audit image",
        },
      },
      {
        type: "video",
        attrs: {
          src: attachmentUrl(video),
          attachmentId: video.id,
          size: video.fileSize,
          width: "60%",
          align: "center",
          alt: "Editor audit video alt text",
        },
      },
      {
        type: "audio",
        attrs: {
          src: attachmentUrl(audio),
          attachmentId: audio.id,
          size: audio.fileSize,
        },
      },
      {
        type: "pdf",
        attrs: {
          src: attachmentUrl(pdf),
          name: pdf.fileName,
          attachmentId: pdf.id,
          size: pdf.fileSize,
          width: 800,
          height: 360,
        },
      },
      {
        type: "attachment",
        attrs: {
          url: attachmentUrl(generic),
          name: generic.fileName,
          mime: generic.mimeType,
          size: generic.fileSize,
          attachmentId: generic.id,
          displayMode: "file",
        },
      },
      {
        type: "drawio",
        attrs: {
          src: attachmentUrl(image),
          title: "Draw.io diagram alt text",
          attachmentId: image.id,
          width: "100%",
          widthMode: "wide",
          align: "center",
        },
      },
      {
        type: "excalidraw",
        attrs: {
          src: attachmentUrl(image),
          title: "Excalidraw diagram alt text",
          attachmentId: image.id,
          width: "100%",
          widthMode: "full",
          align: "center",
        },
      },
      {
        type: "codeBlock",
        attrs: { language: "typescript", widthMode: "normal" },
        content: [text("const audit = true;")],
      },
      {
        type: "codeBlock",
        attrs: { language: "mermaid", widthMode: "wide" },
        content: [text(validMermaid)],
      },
      {
        type: "codeBlock",
        attrs: { language: "mermaid", widthMode: "normal" },
        content: [text(invalidMermaid)],
      },
      {
        type: "codeBlock",
        attrs: { language: "mermaid", widthMode: "full" },
        content: [text(maliciousMermaid)],
      },
      {
        type: "embed",
        attrs: {
          src: "https://example.com/",
          provider: "iframe",
          width: 640,
          height: 360,
          align: "center",
        },
      },
      {
        type: "youtube",
        attrs: {
          src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          width: 640,
          height: 360,
        },
      },
      {
        type: "linkPreview",
        attrs: {
          url: "https://example.com/",
          title: "External safe preview",
          description: "Static external preview metadata",
          siteName: "example.com",
          image: "",
        },
      },
      {
        type: "linkPreview",
        attrs: {
          url: internalUrl,
          title: sourcePage.title,
          description: "Internal page preview",
          siteName: state.spaceName,
          image: "",
        },
      },
      paragraph(text("Page mention: "), {
        type: "mention",
        attrs: {
          id: uniqueId("mention"),
          label: sourcePage.title,
          entityType: "page",
          entityId: sourcePage.id,
          slugId: sourcePage.slugId,
        },
      }),
      paragraph(text("Inline audit tag "), {
        type: "tag",
        attrs: { value: "todo" },
      }),
      { type: "subpages" },
      {
        type: "transclusionSource",
        attrs: { id: uniqueId("local-source") },
        content: [paragraph(text("Local synced block source"))],
      },
      {
        type: "transclusionReference",
        attrs: {
          sourcePageId: sourcePage.id,
          transclusionId: sourceTransclusionId,
        },
      },
      paragraph(text("Large paste anchor")),
    ],
  };

  await updatePageContent(api, page.id, content);
  return {
    page,
    childPage,
    sourcePage,
    sourceTransclusionId,
    expectedNodeTypes: [
      "doc",
      "text",
      "paragraph",
      "heading",
      "blockquote",
      "bulletList",
      "orderedList",
      "listItem",
      "taskList",
      "taskItem",
      "horizontalRule",
      "hardBreak",
      "details",
      "detailsSummary",
      "detailsContent",
      "callout",
      "mathInline",
      "mathBlock",
      "table",
      "tableRow",
      "tableCell",
      "tableHeader",
      "pageBreak",
      "image",
      "video",
      "audio",
      "pdf",
      "attachment",
      "drawio",
      "excalidraw",
      "codeBlock",
      "embed",
      "youtube",
      "linkPreview",
      "mention",
      "tag",
      "subpages",
      "transclusionSource",
      "transclusionReference",
    ],
    expectedMarkTypes: [
      "bold",
      "italic",
      "underline",
      "strike",
      "code",
      "superscript",
      "subscript",
      "highlight",
      "textStyle",
      "link",
      "comment",
    ],
  };
}

export function pageUrl(state: AuditState, page: PageRecord): string {
  return `/s/${state.spaceSlug}/p/${page.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${page.slugId}`;
}
