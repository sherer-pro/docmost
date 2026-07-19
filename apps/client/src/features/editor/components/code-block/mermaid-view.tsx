import { NodeViewProps } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import mermaid from "mermaid";
import { v4 as uuidv4 } from "uuid";
import classes from "./code-block.module.css";
import { useTranslation } from "react-i18next";
import { useComputedColorScheme } from "@mantine/core";
import createDOMPurify from "dompurify";
import { sanitizeMermaidSvg } from "./mermaid-sanitizer";
import { ImagePreviewModal } from "@/features/editor/components/common/image-preview-modal";

const DOMPurify = createDOMPurify(window);

type MermaidTheme = "default" | "dark";

type MermaidRenderResult =
  | { status: "idle" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

const mermaidRenderCache = new Map<string, MermaidRenderResult>();
let initializedTheme: MermaidTheme | null = null;

interface MermaidViewProps {
  props: NodeViewProps;
}

function getMermaidTheme(colorScheme: string): MermaidTheme {
  return colorScheme === "light" ? "default" : "dark";
}

function initializeMermaid(theme: MermaidTheme) {
  if (initializedTheme === theme) {
    return;
  }

  /**
   * Mermaid rendering security policy:
   * - Set `securityLevel: 'strict'` explicitly to avoid version-specific defaults.
   * - Keep `startOnLoad` off because diagrams are rendered programmatically via `mermaid.render`.
   * - Keep `suppressErrorRendering` enabled to safely control error output ourselves.
   */
  mermaid.initialize({
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme,
  });
  initializedTheme = theme;
}

function getCacheKey(source: string, theme: MermaidTheme): string {
  return `${theme}\u0000${source}`;
}

function sanitizeMermaidError(error: unknown): string {
  return DOMPurify.sanitize(String(error));
}

export default function MermaidView({ props }: MermaidViewProps) {
  const { t } = useTranslation();
  const computedColorScheme = useComputedColorScheme();
  const { editor, node } = props;
  const [renderResult, setRenderResult] = useState<MermaidRenderResult>({
    status: "idle",
  });
  const [isLightboxOpened, setIsLightboxOpened] = useState(false);
  const mermaidTheme = getMermaidTheme(computedColorScheme);

  useEffect(() => {
    const source = node.textContent;
    if (source.length === 0) {
      setRenderResult({ status: "idle" });
      setIsLightboxOpened(false);
      return;
    }

    initializeMermaid(mermaidTheme);

    const cacheKey = getCacheKey(source, mermaidTheme);
    const cachedResult = mermaidRenderCache.get(cacheKey);
    if (cachedResult) {
      setRenderResult(cachedResult);
      if (cachedResult.status === "error") {
        setIsLightboxOpened(false);
      }
      return;
    }

    let isCancelled = false;
    const id = `mermaid-${uuidv4()}`;

    mermaid
      .render(id, source)
      .then((item) => {
        const nextResult: MermaidRenderResult = {
          status: "success",
          svg: sanitizeMermaidSvg(item.svg),
        };
        mermaidRenderCache.set(cacheKey, nextResult);

        if (!isCancelled) {
          setRenderResult(nextResult);
        }
      })
      .catch((err) => {
        const nextResult: MermaidRenderResult = {
          status: "error",
          message: sanitizeMermaidError(err),
        };
        mermaidRenderCache.set(cacheKey, nextResult);

        if (!isCancelled) {
          setRenderResult(nextResult);
          setIsLightboxOpened(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [node.textContent, mermaidTheme]);

  const preview = useMemo(() => {
    if (renderResult.status === "success") {
      return renderResult.svg;
    }

    if (renderResult.status === "error") {
      return editor.isEditable
        ? `<div class="${classes.error}">${t("Mermaid diagram error:")} ${renderResult.message}</div>`
        : `<div class="${classes.error}">${t("Invalid Mermaid diagram")}</div>`;
    }

    return "";
  }, [editor.isEditable, renderResult, t]);

  useEffect(() => {
    if (renderResult.status === "error") {
      setIsLightboxOpened(false);
    }
  }, [renderResult.status]);

  const hasPreviewError = renderResult.status === "error";
  const canOpenLightbox =
    !editor.isEditable && preview.length > 0 && !hasPreviewError;

  return (
    <>
      <div
        className={`${classes.mermaid} ${
          canOpenLightbox ? classes.mermaidInteractive : ""
        }`}
        contentEditable={false}
        onClick={() => {
          if (canOpenLightbox) {
            setIsLightboxOpened(true);
          }
        }}
        dangerouslySetInnerHTML={{ __html: preview }}
      ></div>

      <ImagePreviewModal
        opened={isLightboxOpened}
        onClose={() => setIsLightboxOpened(false)}
        title={t("Mermaid diagram")}
      >
        <div
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      </ImagePreviewModal>
    </>
  );
}
