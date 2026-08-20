import React, { lazy, Suspense, type ComponentType } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

type NodeViewLoader = () => Promise<{
  default: ComponentType<NodeViewProps>;
}>;

function createLazyNodeView(
  displayName: string,
  loader: NodeViewLoader,
  inline = false,
) {
  const LazyView = lazy(loader);
  const DeferredNodeView = (props: NodeViewProps) => (
    <Suspense
      fallback={
        <NodeViewWrapper
          as={inline ? "span" : "div"}
          data-node-view-loading="true"
        />
      }
    >
      <LazyView {...props} />
    </Suspense>
  );
  DeferredNodeView.displayName = displayName;
  return DeferredNodeView;
}

export const LazyMathInlineView = createLazyNodeView(
  "LazyMathInlineView",
  () => import("./math/math-inline"),
  true,
);
export const LazyMathBlockView = createLazyNodeView(
  "LazyMathBlockView",
  () => import("./math/math-block"),
);
export const LazyImageView = createLazyNodeView(
  "LazyImageView",
  () => import("./image/image-view"),
);
export const LazyVideoView = createLazyNodeView(
  "LazyVideoView",
  () => import("./video/video-view"),
);
export const LazyAudioView = createLazyNodeView(
  "LazyAudioView",
  () => import("./audio/audio-view"),
);
export const LazyAttachmentView = createLazyNodeView(
  "LazyAttachmentView",
  () => import("./attachment/attachment-view"),
);
export const LazyCodeBlockView = createLazyNodeView(
  "LazyCodeBlockView",
  () => import("./code-block/code-block-view"),
);
export const LazyDrawioView = createLazyNodeView(
  "LazyDrawioView",
  () => import("./drawio/drawio-view"),
);
export const LazyExcalidrawView = createLazyNodeView(
  "LazyExcalidrawView",
  () => import("./excalidraw/excalidraw-view"),
);
export const LazyEmbedView = createLazyNodeView(
  "LazyEmbedView",
  () => import("./embed/embed-view"),
);
export const LazyLinkPreviewView = createLazyNodeView(
  "LazyLinkPreviewView",
  () => import("./link-preview/link-preview-view"),
);
export const LazyPdfView = createLazyNodeView(
  "LazyPdfView",
  () => import("./pdf/pdf-view"),
);
export const LazySubpagesView = createLazyNodeView(
  "LazySubpagesView",
  () => import("./subpages/subpages-view"),
);
export const LazyTemplateFieldView = createLazyNodeView(
  "LazyTemplateFieldView",
  () =>
    import("./page-template/template-node-views").then((module) => ({
      default: module.TemplateFieldView,
    })),
);
export const LazyTemplateManagedBlockView = createLazyNodeView(
  "LazyTemplateManagedBlockView",
  () =>
    import("./page-template/template-node-views").then((module) => ({
      default: module.TemplateManagedBlockView,
    })),
);
