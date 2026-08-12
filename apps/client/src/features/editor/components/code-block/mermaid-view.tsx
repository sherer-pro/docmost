import { NodeViewProps } from "@tiptap/react";
import classes from "./code-block.module.css";
import { useTranslation } from "react-i18next";
import { MermaidDiagram } from "@/features/editor/components/common/mermaid-diagram";

interface MermaidViewProps {
  props: NodeViewProps;
}

export default function MermaidView({ props }: MermaidViewProps) {
  const { t } = useTranslation();
  const { editor, node } = props;

  return (
    <div contentEditable={false}>
      <MermaidDiagram
        source={node.textContent}
        accessibleName={t("Mermaid diagram")}
        previewTitle={t("Mermaid diagram")}
        expandLabel={t("Mermaid diagram")}
        invalidLabel={t("Invalid Mermaid diagram")}
        errorLabel={t("Mermaid diagram error:")}
        showErrorDetails={editor.isEditable}
        enablePreview={!editor.isEditable}
        openOnDiagramClick={!editor.isEditable}
        diagramClassName={classes.mermaid}
      />
    </div>
  );
}
