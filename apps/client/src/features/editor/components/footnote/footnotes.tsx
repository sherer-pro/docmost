import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Anchor,
  Alert,
  Button,
  Group,
  Popover,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import {
  NodeViewWrapper,
  useCurrentEditor,
  useEditorState,
  type Editor,
  type NodeViewProps,
} from "@tiptap/react";
import { useTranslation } from "react-i18next";
import {
  footnotePluginKey,
  FOOTNOTE_TEXT_LIMIT,
  type FootnoteEntry,
} from "@docmost/editor-ext";

const scopes = new WeakMap<Editor, string>();
let nextScope = 0;
function scope(editor: Editor) {
  let value = scopes.get(editor);
  if (!value) {
    value = `docmost-notes-${++nextScope}`;
    scopes.set(editor, value);
  }
  return value;
}
const noteId = (editor: Editor, entry: FootnoteEntry) =>
  `${scope(editor)}-note-${entry.id}`;
const referenceId = (editor: Editor, entry: FootnoteEntry) =>
  `${scope(editor)}-reference-${entry.id}`;
const reveal = (id: string, focus = true) => {
  const element = document.getElementById(id);
  if (!element) return false;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  if (focus) element.focus({ preventScroll: true });
  return true;
};

export default function FootnoteReference({
  editor,
  node,
  getPos,
}: NodeViewProps) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const entry = useEditorState({
    editor,
    selector: ({ editor }) => {
      try {
        const position = getPos();
        return typeof position === "number"
          ? footnotePluginKey.getState(editor.state)?.byPosition.get(position)
          : undefined;
      } catch {
        return undefined;
      }
    },
  });
  if (!entry)
    return (
      <NodeViewWrapper as="sup" contentEditable={false}>
        *
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper as="sup" data-type="footnote" contentEditable={false}>
      <Popover
        opened={opened}
        onChange={setOpened}
        width={300}
        withArrow
        withinPortal
      >
        <Popover.Target>
          <Anchor
            id={referenceId(editor, entry)}
            href={`#${encodeURIComponent(noteId(editor, entry))}`}
            role="doc-noteref"
            aria-label={t("docBlocks.footnoteReference", {
              number: entry.number,
            })}
            title={entry.text}
            onClick={(event) => {
              event.preventDefault();
              if (!reveal(noteId(editor, entry))) setOpened((value) => !value);
            }}
          >
            {entry.number}
          </Anchor>
        </Popover.Target>
        <Popover.Dropdown>
          <Text
            size="sm"
            style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {entry.text || t("docBlocks.emptyFootnote")}
          </Text>
        </Popover.Dropdown>
      </Popover>
    </NodeViewWrapper>
  );
}

export function Footnotes({ editor: provided }: { editor?: Editor | null }) {
  const context = useCurrentEditor();
  const editor = provided === undefined ? context.editor : provided;
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor
        ? {
            entries: footnotePluginKey.getState(editor.state)?.entries ?? [],
            editable: editor.isEditable,
            results: editor.storage.searchAndReplace?.results ?? [],
            resultIndex: editor.storage.searchAndReplace?.resultIndex ?? -1,
          }
        : null,
  });
  const [editing, setEditing] = useState<{
    id: string;
    base: string;
    draft: string;
  } | null>(null);
  const [conflict, setConflict] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const pendingFocus = useRef<{
    editor: Editor;
    id: string;
    origin: Element | null;
  } | null>(null);
  const begin = (entry: FootnoteEntry) => {
    if (!editor?.isEditable || editor.isDestroyed) return;
    pendingFocus.current = {
      editor,
      id: entry.id,
      origin: document.activeElement,
    };
    setConflict(false);
    setEditing({ id: entry.id, base: entry.text, draft: entry.text });
  };
  useLayoutEffect(() => {
    const request = pendingFocus.current;
    if (!request) return;
    pendingFocus.current = null;
    if (
      request.editor !== editor ||
      editor?.isDestroyed ||
      !state?.editable ||
      editing?.id !== request.id ||
      !state.entries.some((entry) => entry.id === request.id) ||
      (document.activeElement !== request.origin &&
        (request.origin?.isConnected ||
          document.activeElement !== document.body))
    )
      return;
    textarea.current?.focus();
  }, [editor, editing, state]);
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.editor !== editor || !editor?.isEditable) return;
      const entry = footnotePluginKey
        .getState(editor.state)
        ?.entries.find((item) => item.id === detail.id);
      if (entry) begin(entry);
    };
    window.addEventListener("docmost:edit-footnote", open);
    return () => window.removeEventListener("docmost:edit-footnote", open);
  }, [editor]);
  useEffect(() => {
    const search = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (
        !editor ||
        detail?.editor !== editor ||
        typeof detail.position !== "number"
      )
        return;
      const entry = footnotePluginKey
        .getState(editor.state)
        ?.entries.find(
          (item) =>
            detail.position > item.position &&
            detail.position <= item.position + item.text.length,
        );
      if (entry && reveal(noteId(editor, entry), false)) event.preventDefault();
    };
    document.addEventListener("docmost:reveal-search-match", search);
    return () =>
      document.removeEventListener("docmost:reveal-search-match", search);
  }, [editor]);
  if (!editor || !state?.entries.length) return null;
  const highlighted = (entry: FootnoteEntry) => {
    const parts: ReactNode[] = [];
    let end = 0;
    state.results.forEach((range, index) => {
      if (
        range.from <= entry.position ||
        range.to > entry.position + 1 + entry.text.length
      )
        return;
      const start = range.from - entry.position - 1;
      const stop = range.to - entry.position - 1;
      parts.push(
        entry.text.slice(end, start),
        <mark
          key={range.from}
          className={`search-result${index === state.resultIndex ? " search-result-current" : ""}`}
        >
          {entry.text.slice(start, stop)}
        </mark>,
      );
      end = stop;
    });
    parts.push(entry.text.slice(end));
    return parts;
  };
  const save = () => {
    if (!editing || !editor.isEditable) return;
    const current = footnotePluginKey
      .getState(editor.state)
      ?.entries.find((entry) => entry.id === editing.id);
    if (!current || current.text !== editing.base) {
      setConflict(true);
      return;
    }
    const node = editor.state.doc.nodeAt(current.position);
    if (node?.type.name !== "footnote") return;
    editor
      .chain()
      .command(({ tr }) => {
        tr.replaceWith(
          current.position + 1,
          current.position + node.nodeSize - 1,
          editing.draft ? editor.schema.text(editing.draft) : [],
        );
        tr.setNodeMarkup(current.position, undefined, {
          ...node.attrs,
          text: "",
        });
        return true;
      })
      .run();
    setEditing(null);
  };
  return (
    <section
      role="doc-endnotes"
      aria-label={t("docBlocks.footnotes")}
      style={{
        borderTop: "1px solid var(--mantine-color-default-border)",
        marginTop: 24,
        paddingTop: 12,
      }}
    >
      <Text fw={600}>{t("docBlocks.footnotes")}</Text>
      <ol>
        {state.entries.map((entry) => (
          <li
            key={entry.id}
            id={noteId(editor, entry)}
            tabIndex={-1}
            style={{ paddingBlock: 6, overflowWrap: "anywhere" }}
          >
            {state.editable && editing?.id === entry.id ? (
              <Stack gap="xs">
                <Textarea
                  ref={textarea}
                  label={t("docBlocks.footnoteReference", {
                    number: entry.number,
                  })}
                  autosize
                  minRows={2}
                  maxLength={FOOTNOTE_TEXT_LIMIT}
                  value={editing.draft}
                  onChange={(event) =>
                    setEditing({ ...editing, draft: event.currentTarget.value })
                  }
                />
                {conflict && (
                  <Alert color="orange" role="alert">
                    {t("docBlocks.footnoteChanged")}
                  </Alert>
                )}
                <Group>
                  <Button size="xs" onClick={save}>
                    {t("Save")}
                  </Button>
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() => setEditing(null)}
                  >
                    {t("Cancel")}
                  </Button>
                </Group>
              </Stack>
            ) : (
              <>
                <Text component="span" style={{ whiteSpace: "pre-wrap" }}>
                  {entry.text
                    ? highlighted(entry)
                    : t("docBlocks.emptyFootnote")}
                </Text>{" "}
                <Anchor
                  href={`#${encodeURIComponent(referenceId(editor, entry))}`}
                  aria-label={t("docBlocks.backToReference", {
                    number: entry.number,
                  })}
                  onClick={(event) => {
                    event.preventDefault();
                    reveal(referenceId(editor, entry));
                  }}
                >
                  [{entry.number}]
                </Anchor>
                {state.editable && (
                  <Button
                    ml="xs"
                    variant="subtle"
                    size="compact-sm"
                    onClick={() => begin(entry)}
                  >
                    {t("Edit")}
                  </Button>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
