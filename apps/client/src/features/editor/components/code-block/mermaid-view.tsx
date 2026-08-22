import { NodeViewProps } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { MermaidDiagram } from "@/features/editor/components/common/mermaid-diagram";

interface MermaidViewProps {
  props: NodeViewProps;
  diagramClassName?: string;
}

export default function MermaidView({
  props,
  diagramClassName,
}: MermaidViewProps) {
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
        diagramClassName={diagramClassName}
      />
    </div>
  );
}
