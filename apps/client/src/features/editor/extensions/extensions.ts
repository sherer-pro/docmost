import { StarterKit } from "@tiptap/starter-kit";
import { TextAlign } from "@tiptap/extension-text-align";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { Placeholder, CharacterCount } from "@tiptap/extensions";
import { Superscript } from "@tiptap/extension-superscript";
import SubScript from "@tiptap/extension-subscript";
import { Typography } from "@tiptap/extension-typography";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import { Youtube } from "@tiptap/extension-youtube";
import SlashCommand from "@/features/editor/extensions/slash-command";
import { Collaboration, isChangeOrigin } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  Comment,
  Details,
  DetailsContent,
  DetailsSummary,
  MathBlock,
  MathInline,
  TableCell,
  TableRow,
  TableHeader,
  CustomTable,
  TrailingNode,
  TiptapImage,
  Callout,
  TiptapVideo,
  TiptapAudio,
  LinkExtension,
  LinkPreview,
  Selection,
  Attachment,
  TiptapPdf,
  CustomCodeBlock,
  Drawio,
  Excalidraw,
  Embed,
  SearchAndReplace,
  Mention,
  TableDndExtension,
  TablePaste,
  TableReadonlySort,
  Subpages,
  Heading,
  HeadingNumbering,
  Highlight,
  UniqueID,
  SharedStorage,
  Indent,
  PageBreak,
  Tag,
  builtInTagDefinitions,
  TransclusionSource,
  TransclusionReference,
  TemplateField,
  TemplateManagedBlock,
} from "@docmost/editor-ext";
import type { BuiltInTagValue, TagDefinition } from "@docmost/editor-ext";
import { getUserColor } from "@/features/editor/extensions/utils.ts";
import { IUser } from "@/features/user/types/user.types.ts";
import CalloutView from "@/features/editor/components/callout/callout-view.tsx";
import TagView from "@/features/editor/components/tag/tag-view.tsx";
import TransclusionView from "@/features/editor/components/transclusion/transclusion-view.tsx";
import TransclusionReferenceView from "@/features/editor/components/transclusion/transclusion-reference-view.tsx";
import {
  LazyAttachmentView,
  LazyAudioView,
  LazyCodeBlockView,
  LazyDrawioView,
  LazyEmbedView,
  LazyExcalidrawView,
  LazyImageView,
  LazyLinkPreviewView,
  LazyMathBlockView,
  LazyMathInlineView,
  LazyPdfView,
  LazySubpagesView,
  LazyTemplateFieldView,
  LazyTemplateManagedBlockView,
  LazyVideoView,
} from "@/features/editor/components/lazy-node-views";
import { common, createLowlight } from "lowlight";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import abap from "highlightjs-sap-abap";
import elixir from "highlight.js/lib/languages/elixir";
import erlang from "highlight.js/lib/languages/erlang";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import clojure from "highlight.js/lib/languages/clojure";
import fortran from "highlight.js/lib/languages/fortran";
import haskell from "highlight.js/lib/languages/haskell";
import scala from "highlight.js/lib/languages/scala";
import mentionRenderItems from "@/features/editor/components/mention/mention-suggestion.ts";
import { ReactNodeViewRenderer } from "@tiptap/react";
import MentionView from "@/features/editor/components/mention/mention-view.tsx";
import i18n from "@/i18n.ts";
import { MarkdownClipboard } from "@/features/editor/extensions/markdown-clipboard.ts";
import EmojiCommand from "./emoji-command";
import { InlineCodeNoWrap } from "./inline-code-no-wrap";
import { TransclusionClipboard } from "./transclusion-clipboard";
import { TransclusionDeletionGuard } from "./transclusion-deletion-guard";
import { TagClipboard } from "./tag-clipboard";
import { notifications } from "@mantine/notifications";

const lowlight = createLowlight(common);
lowlight.register("mermaid", plaintext);
lowlight.register("powershell", powershell);
lowlight.register("abap", abap);
lowlight.register("erlang", erlang);
lowlight.register("elixir", elixir);
lowlight.register("dockerfile", dockerfile);
lowlight.register("clojure", clojure);
lowlight.register("fortran", fortran);
lowlight.register("haskell", haskell);
lowlight.register("scala", scala);

export const mainExtensions = [
  StarterKit.configure({
    heading: false,
    undoRedo: false,
    link: false,
    trailingNode: false,
    dropcursor: {
      width: 3,
      color: "#70CFF8",
    },
    codeBlock: false,
    code: {
      HTMLAttributes: {
        spellcheck: false,
      },
    },
  }),
  InlineCodeNoWrap,
  SharedStorage,
  Heading,
  HeadingNumbering,
  UniqueID.configure({
    types: ["heading", "paragraph", "transclusionSource"],
    filterTransaction: (transaction) => !isChangeOrigin(transaction),
  }),
  Placeholder.configure({
    placeholder: ({ node }) => {
      if (node.type.name === "heading") {
        return i18n.t("Heading {{level}}", { level: node.attrs.level });
      }
      if (node.type.name === "detailsSummary") {
        return i18n.t("Toggle title");
      }
      if (node.type.name === "paragraph") {
        return i18n.t('Write anything. Enter "/" for commands');
      }
    },
    includeChildren: true,
    showOnlyWhenEditable: true,
  }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Indent.configure({ types: ["heading", "paragraph"] }),
  TaskList,
  TaskItem.configure({
    nested: true,
  }),
  LinkExtension.configure({
    openOnClick: false,
  }),
  Superscript,
  SubScript,
  Highlight.configure({
    multicolor: true,
  }),
  Typography,
  TrailingNode,
  GlobalDragHandle.configure({
    customNodes: ["transclusionSource", "transclusionReference"],
  }),
  TextStyle,
  Color,
  SlashCommand,
  EmojiCommand,
  Comment.configure({
    HTMLAttributes: {
      class: "comment-mark",
    },
  }),
  Mention.configure({
    suggestion: {
      allowSpaces: true,
      items: () => {
        return [];
      },
      // @ts-ignore
      render: mentionRenderItems,
    },
    HTMLAttributes: {
      class: "mention",
    },
  }).extend({
    addNodeView() {
      // Force the react node view to render immediately using flush sync (https://github.com/ueberdosis/tiptap/blob/b4db352f839e1d82f9add6ee7fb45561336286d8/packages/react/src/ReactRenderer.tsx#L183-L191)
      this.editor.isInitialized = true;

      return ReactNodeViewRenderer(MentionView);
    },
  }),
  CustomTable.configure({
    allowTableNodeSelection: true,
    resizable: false,
    cellMinWidth: 48,
  }),
  TableRow,
  TableCell,
  TableHeader,
  TableDndExtension.configure({
    getLabel: (key) =>
      key === "moveColumn" ? i18n.t("Move column") : i18n.t("Move row"),
  }),
  TablePaste,
  TableReadonlySort.configure({
    getLabel: (key) => {
      if (key === "sortDescending") {
        return i18n.t("Sort descending");
      }

      if (key === "clearSort") {
        return i18n.t("Clear sort");
      }

      return i18n.t("Sort ascending");
    },
  }),
  MathInline.configure({
    view: ReactNodeViewRenderer(LazyMathInlineView),
  }),
  MathBlock.configure({
    view: ReactNodeViewRenderer(LazyMathBlockView),
  }),
  Details.configure({
    getToggleButtonLabel: () => i18n.t("Toggle title"),
  }),
  DetailsSummary,
  DetailsContent,
  PageBreak,
  Tag.configure({
    view: ReactNodeViewRenderer(TagView),
  }),
  Youtube.configure({
    addPasteHandler: false,
    controls: true,
    nocookie: true,
    HTMLAttributes: {
      title: "YouTube video",
    },
  }),
  TiptapImage.configure({
    view: ReactNodeViewRenderer(LazyImageView),
    allowBase64: false,
  }),
  TiptapVideo.configure({
    view: ReactNodeViewRenderer(LazyVideoView),
  }),
  TiptapAudio.configure({
    view: ReactNodeViewRenderer(LazyAudioView),
  }),
  Callout.configure({
    view: ReactNodeViewRenderer(CalloutView),
  }),
  CustomCodeBlock.configure({
    view: ReactNodeViewRenderer(LazyCodeBlockView),
    //@ts-ignore
    lowlight,
    HTMLAttributes: {
      spellcheck: false,
    },
  }),
  Selection,
  Attachment.configure({
    view: ReactNodeViewRenderer(LazyAttachmentView),
  }),
  TiptapPdf.configure({
    view: ReactNodeViewRenderer(LazyPdfView),
  }),
  Drawio.configure({
    view: ReactNodeViewRenderer(LazyDrawioView),
  }),
  Excalidraw.configure({
    view: ReactNodeViewRenderer(LazyExcalidrawView),
  }),
  Embed.configure({
    view: ReactNodeViewRenderer(LazyEmbedView),
  }),
  LinkPreview.configure({
    view: ReactNodeViewRenderer(LazyLinkPreviewView),
  }),
  Subpages.configure({
    view: ReactNodeViewRenderer(LazySubpagesView),
  }),
  TransclusionSource.configure({
    view: ReactNodeViewRenderer(TransclusionView),
  }),
  TransclusionReference.configure({
    view: ReactNodeViewRenderer(TransclusionReferenceView),
    getContentExtensions: () => transclusionContentExtensions,
  }),
  TemplateManagedBlock.configure({
    view: ReactNodeViewRenderer(LazyTemplateManagedBlockView),
  }),
  TemplateField.configure({
    view: ReactNodeViewRenderer(LazyTemplateFieldView),
  }),
  TransclusionDeletionGuard.configure({
    onBlocked: (reason) => {
      notifications.show({
        id: "transclusion-source-deletion-blocked",
        color: "orange",
        message:
          reason === "referenced"
            ? i18n.t(
                "Delete or unsync all copies before removing this synced block.",
              )
            : i18n.t(
                "Could not verify synced block copies. Refresh the page and try again.",
              ),
      });
    },
  }),
  TransclusionClipboard,
  TagClipboard,
  MarkdownClipboard.configure({
    transformPastedText: true,
  }),
  CharacterCount.configure({
    // Count words by splitting on whitespace. This mirrors TipTap's default
    // counter and avoids inflated counts from punctuation-heavy content such
    // as URLs, numbers with separators, and abbreviations.
    wordCounter: (text) =>
      text.split(/\s+/).filter((word) => word.length > 0).length,
  }),
  SearchAndReplace.extend({
    addKeyboardShortcuts() {
      return {
        "Mod-f": () => {
          const event = new CustomEvent("openFindDialogFromEditor", {});
          document.dispatchEvent(event);
          return true;
        },
        Escape: () => {
          const event = new CustomEvent("closeFindDialogFromEditor", {});
          document.dispatchEvent(event);
          return false;
        },
      };
    },
  }).configure(),
] as any;

const readOnlyExcludedExtensions = new Set([
  "uniqueID",
  "globalDragHandle",
  "placeholder",
  "trailingNode",
  "slash-command",
  "emoji-command",
  "selection",
  "table-drag-and-drop",
  "tablePaste",
  "transclusionDeletionGuard",
  "transclusionClipboard",
  "markdownClipboard",
  "characterCount",
  "searchAndReplace",
]);

export const transclusionContentExtensions = mainExtensions.filter(
  (extension: any) => !readOnlyExcludedExtensions.has(extension.name),
);

export interface MainExtensionsOptions {
  tagDefinitions?: readonly TagDefinition[];
  onSearchTag?: (value: BuiltInTagValue) => void;
}

export const createMainExtensions = ({
  tagDefinitions = builtInTagDefinitions,
  onSearchTag,
}: MainExtensionsOptions = {}) =>
  mainExtensions.map((extension: any) =>
    extension.name === "tag"
      ? Tag.configure({
          view: ReactNodeViewRenderer(TagView),
          tagDefinitions,
          onSearch: onSearchTag,
        })
      : extension,
  );

export const createReadOnlyExtensions = (options?: MainExtensionsOptions) =>
  createMainExtensions(options).filter(
    (extension: any) => !readOnlyExcludedExtensions.has(extension.name),
  );

type CollabExtensions = (provider: HocuspocusProvider, user: IUser) => any[];

export const collabExtensions: CollabExtensions = (provider, user) => [
  Collaboration.configure({
    document: provider.document,
    provider,
  }),
  CollaborationCaret.configure({
    provider,
    user: {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      color: getUserColor(user.id),
    },
  }),
];
