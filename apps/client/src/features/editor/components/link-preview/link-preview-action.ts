import { Editor } from "@tiptap/core";
import { getLinkPreview } from "@/features/page/services/page-service";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function createLinkPreviewRequestId(): string {
  return `link-preview-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type LinkPreviewNodeMatch = {
  pos: number;
  attrs: Record<string, any>;
  nodeSize: number;
};

function findLinkPreviewNode(editor: Editor, requestId: string): LinkPreviewNodeMatch | null {
  let match: LinkPreviewNodeMatch | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "linkPreview" && node.attrs.requestId === requestId) {
      match = {
        pos,
        attrs: node.attrs as Record<string, any>,
        nodeSize: node.nodeSize,
      };
      return false;
    }

    return true;
  });

  return match;
}

function updateLinkPreviewNode(
  editor: Editor,
  requestId: string,
  attributes: Record<string, any>,
): boolean {
  const match = findLinkPreviewNode(editor, requestId);
  if (!match) {
    return false;
  }

  const tr = editor.state.tr.setNodeMarkup(match.pos, undefined, {
    ...match.attrs,
    ...attributes,
  });
  editor.view.dispatch(tr);

  return true;
}

function replaceLinkPreviewWithUrl(editor: Editor, requestId: string, url: string): boolean {
  const match = findLinkPreviewNode(editor, requestId);
  if (!match) {
    return false;
  }

  const tr = editor.state.tr.replaceWith(
    match.pos,
    match.pos + match.nodeSize,
    editor.state.schema.text(url),
  );
  editor.view.dispatch(tr);

  return true;
}

export async function createLinkPreviewAction(editor: Editor, rawUrl: string) {
  const url = rawUrl.trim();

  if (!isHttpUrl(url)) {
    return false;
  }

  const requestId = createLinkPreviewRequestId();
  const inserted = editor
    .chain()
    .focus()
    .setLinkPreview({
      url,
      title: "",
      description: "",
      image: "",
      siteName: "",
      loading: true,
      requestId,
    })
    .run();

  if (!inserted) {
    return false;
  }

  try {
    const preview = await getLinkPreview(url);

    updateLinkPreviewNode(editor, requestId, {
      url: preview.url,
      title: preview.title,
      description: preview.description,
      image: preview.image ?? "",
      siteName: preview.siteName,
      loading: false,
      requestId: "",
    });

    return true;
  } catch {
    replaceLinkPreviewWithUrl(editor, requestId, url);
    return true;
  }
}
