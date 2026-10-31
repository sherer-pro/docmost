import { Button, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import type { Editor } from "@tiptap/core";
import type { IntegrationPreviewTarget } from "@docmost/editor-ext";
import i18n from "@/i18n";
import { getIntegrationPreviewSettings } from "@/features/integration-preview/integration-preview-service";

export async function chooseIntegrationPaste(
  editor: Editor,
  target: IntegrationPreviewTarget,
): Promise<boolean> {
  let bookmark = editor.state.selection.getBookmark();
  const track = ({ transaction }: { transaction: any }) => {
    bookmark = bookmark.map(transaction.mapping);
  };
  editor.on("transaction", track);
  let inserted = false;
  const insert = (kind: "link" | "mention" | "card") => {
    if (inserted || editor.isDestroyed || !editor.isEditable) return;
    inserted = true;
    const selection = bookmark.resolve(editor.state.doc);
    const content =
      kind === "link"
        ? {
            type: "text",
            text: target.url,
            marks: [{ type: "link", attrs: { href: target.url } }],
          }
        : {
            type: kind === "card" ? "integrationPreview" : "integrationMention",
            attrs: { url: target.url },
          };
    editor
      .chain()
      .focus()
      .setTextSelection({ from: selection.from, to: selection.to })
      .insertContent(content)
      .run();
  };
  const settings = await getIntegrationPreviewSettings().catch(() => null);
  if (editor.isDestroyed) {
    editor.off("transaction", track);
    return true;
  }
  if (
    !settings?.enabled ||
    !settings.availableProviders.includes(target.provider)
  ) {
    insert("link");
    editor.off("transaction", track);
    return true;
  }
  const id = modals.open({
    title: i18n.t("integrationPreviews.insertAs"),
    children: (
      <Stack gap="xs">
        <Text size="sm" c="dimmed" style={{ overflowWrap: "anywhere" }}>
          {target.url}
        </Text>
        {(["link", "mention", "card"] as const).map((kind) => (
          <Button
            key={kind}
            variant="light"
            onClick={() => {
              insert(kind);
              modals.close(id);
            }}
          >
            {i18n.t(`integrationPreviews.${kind}`)}
          </Button>
        ))}
      </Stack>
    ),
    onClose: () => {
      insert("link");
      editor.off("transaction", track);
    },
  });
  return true;
}
