import { NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import mermaid from "mermaid";
import { v4 as uuidv4 } from "uuid";
import classes from "./code-block.module.css";
import { useTranslation } from "react-i18next";
import { Modal, useComputedColorScheme } from "@mantine/core";
import createDOMPurify from "dompurify";
import { sanitizeMermaidSvg } from "./mermaid-sanitizer";

const DOMPurify = createDOMPurify(window);

interface MermaidViewProps {
  props: NodeViewProps;
}

export default function MermaidView({ props }: MermaidViewProps) {
  const { t } = useTranslation();
  const computedColorScheme = useComputedColorScheme();
  const { editor, node } = props;
  const [preview, setPreview] = useState<string>("");
  const [hasPreviewError, setHasPreviewError] = useState(false);
  const [isLightboxOpened, setIsLightboxOpened] = useState(false);

  // Update Mermaid config when theme changes.
  useEffect(() => {
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
      theme: computedColorScheme === "light" ? "default" : "dark",
    });
  }, [computedColorScheme]);

  // Re-render the diagram whenever the node content or theme changes.
  useEffect(() => {
    const id = `mermaid-${uuidv4()}`;
    if (node.textContent.length > 0) {
      mermaid
        .render(id, node.textContent)
        .then((item) => {
          setPreview(sanitizeMermaidSvg(item.svg));
          setHasPreviewError(false);
        })
        .catch((err) => {
          setHasPreviewError(true);
          setIsLightboxOpened(false);
          if (editor.isEditable) {
            setPreview(
              `<div class="${classes.error}">${t("Mermaid diagram error:")} ${DOMPurify.sanitize(err)}</div>`,
            );
          } else {
            setPreview(
              `<div class="${classes.error}">${t("Invalid Mermaid diagram")}</div>`,
            );
          }
        });
    }
  }, [node.textContent, computedColorScheme, editor.isEditable, t]);

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

      <Modal
        opened={isLightboxOpened}
        onClose={() => setIsLightboxOpened(false)}
        centered
        size="auto"
        title={t("Mermaid diagram")}
      >
        <div
          className={classes.mermaidLightbox}
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      </Modal>
    </>
  );
}
