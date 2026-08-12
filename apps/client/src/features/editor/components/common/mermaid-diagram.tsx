import { useComputedColorScheme } from "@mantine/core";
import { IconArrowsMaximize } from "@tabler/icons-react";
import createDOMPurify from "dompurify";
import mermaid from "mermaid";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { sanitizeMermaidSvg } from "@/features/editor/components/code-block/mermaid-sanitizer";
import { ImagePreviewModal } from "./image-preview-modal";
import classes from "./mermaid-diagram.module.css";

const DOMPurify = createDOMPurify(window);

type MermaidTheme = "default" | "dark";

type MermaidRenderResult =
  | { status: "idle" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

const mermaidRenderCache = new Map<string, MermaidRenderResult>();
let initializedTheme: MermaidTheme | null = null;

export interface MermaidDiagramProps {
  source: string;
  accessibleName: string;
  caption?: ReactNode;
  textAlternative?: ReactNode;
  previewTitle: ReactNode;
  expandLabel: string;
  invalidLabel: string;
  errorLabel?: string;
  showErrorDetails?: boolean;
  enablePreview?: boolean;
  openOnDiagramClick?: boolean;
  scrollOnNarrow?: boolean;
  onRenderComplete?: () => void;
  className?: string;
  diagramClassName?: string;
}

function getMermaidTheme(colorScheme: string): MermaidTheme {
  return colorScheme === "light" ? "default" : "dark";
}

function initializeMermaid(theme: MermaidTheme) {
  if (initializedTheme === theme) {
    return;
  }

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
  return DOMPurify.sanitize(String(error), { ALLOWED_TAGS: [] });
}

export function MermaidDiagram({
  source,
  accessibleName,
  caption,
  textAlternative,
  previewTitle,
  expandLabel,
  invalidLabel,
  errorLabel,
  showErrorDetails = false,
  enablePreview = true,
  openOnDiagramClick = false,
  scrollOnNarrow = false,
  onRenderComplete,
  className,
  diagramClassName,
}: MermaidDiagramProps) {
  const computedColorScheme = useComputedColorScheme();
  const [renderResult, setRenderResult] = useState<MermaidRenderResult>({
    status: "idle",
  });
  const [isPreviewOpened, setIsPreviewOpened] = useState(false);
  const mermaidTheme = getMermaidTheme(computedColorScheme);

  useEffect(() => {
    if (renderResult.status !== "idle") {
      onRenderComplete?.();
    }
  }, [onRenderComplete, renderResult]);

  useEffect(() => {
    if (source.length === 0) {
      setRenderResult({ status: "idle" });
      setIsPreviewOpened(false);
      return;
    }

    initializeMermaid(mermaidTheme);

    const cacheKey = getCacheKey(source, mermaidTheme);
    const cachedResult = mermaidRenderCache.get(cacheKey);
    if (cachedResult) {
      setRenderResult(cachedResult);
      if (cachedResult.status === "error") {
        setIsPreviewOpened(false);
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
      .catch((error) => {
        const nextResult: MermaidRenderResult = {
          status: "error",
          message: sanitizeMermaidError(error),
        };
        mermaidRenderCache.set(cacheKey, nextResult);

        if (!isCancelled) {
          setRenderResult(nextResult);
          setIsPreviewOpened(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [mermaidTheme, source]);

  const canOpenPreview = enablePreview && renderResult.status === "success";
  const interactiveDiagram = canOpenPreview && openOnDiagramClick;

  const renderedDiagram = useMemo(() => {
    if (renderResult.status === "success") {
      return (
        <div
          role="img"
          aria-label={accessibleName}
          dangerouslySetInnerHTML={{ __html: renderResult.svg }}
        />
      );
    }

    if (renderResult.status === "error") {
      return (
        <div className={classes.error} role="status">
          {showErrorDetails && errorLabel
            ? `${errorLabel} ${renderResult.message}`
            : invalidLabel}
        </div>
      );
    }

    return null;
  }, [
    accessibleName,
    errorLabel,
    invalidLabel,
    renderResult,
    showErrorDetails,
  ]);

  function openPreview() {
    if (canOpenPreview) {
      setIsPreviewOpened(true);
    }
  }

  function handleDiagramKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!interactiveDiagram) {
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPreview();
    }
  }

  return (
    <>
      <figure className={`${classes.figure} ${className ?? ""}`}>
        <div className={classes.frame}>
          <div
            className={`${classes.diagram} ${diagramClassName ?? ""} ${
              interactiveDiagram ? classes.interactive : ""
            } ${scrollOnNarrow ? classes.scrollOnNarrow : ""}`}
            onClick={interactiveDiagram ? openPreview : undefined}
            onKeyDown={handleDiagramKeyDown}
            role={interactiveDiagram ? "button" : undefined}
            tabIndex={interactiveDiagram ? 0 : undefined}
          >
            {renderedDiagram}
          </div>
          {canOpenPreview && (
            <AccessibleActionIcon
              className={classes.expandButton}
              label={expandLabel}
              tooltip={expandLabel}
              variant="filled"
              color="dark"
              onClick={openPreview}
            >
              <IconArrowsMaximize size={17} />
            </AccessibleActionIcon>
          )}
        </div>
        {caption && (
          <figcaption className={classes.caption}>{caption}</figcaption>
        )}
        {textAlternative && (
          <div className={classes.textAlternative}>{textAlternative}</div>
        )}
      </figure>

      <ImagePreviewModal
        opened={isPreviewOpened}
        onClose={() => setIsPreviewOpened(false)}
        title={previewTitle}
      >
        <div
          className={classes.modalDiagram}
          role="img"
          aria-label={accessibleName}
          dangerouslySetInnerHTML={{
            __html: renderResult.status === "success" ? renderResult.svg : "",
          }}
        />
      </ImagePreviewModal>
    </>
  );
}
