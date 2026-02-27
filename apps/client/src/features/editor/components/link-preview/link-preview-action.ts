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

export async function createLinkPreviewAction(editor: Editor, rawUrl: string) {
  const url = rawUrl.trim();

  if (!isHttpUrl(url)) {
    return false;
  }

  try {
    const preview = await getLinkPreview(url);

    editor
      .chain()
      .focus()
      .setLinkPreview({
        url: preview.url,
        title: preview.title,
        description: preview.description,
        image: preview.image ?? "",
        siteName: preview.siteName,
      })
      .run();

    return true;
  } catch {
    return false;
  }
}
