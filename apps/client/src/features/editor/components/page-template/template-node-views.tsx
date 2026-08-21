import { Badge, Group, Text } from "@mantine/core";
import { IconForms, IconLock } from "@tabler/icons-react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { useTranslation } from "react-i18next";
import { useEditorEditable } from "@/features/editor/components/transclusion/use-editor-editable";

export function TemplateManagedBlockView({ node, editor }: NodeViewProps) {
  const { t } = useTranslation();
  const locked = Boolean(node.attrs.locked);
  const editorIsEditable = useEditorEditable(editor);
  const contentIsEditable = editorIsEditable && !locked;

  return (
    <NodeViewWrapper
      data-type="templateManagedBlock"
      data-template-locked={locked ? "true" : undefined}
      data-template-editable={contentIsEditable ? "true" : "false"}
      data-template-block-id={node.attrs.templateBlockId ?? undefined}
      role="group"
      aria-label={t("Shared content")}
    >
      <Group gap={6} mb="xs" contentEditable={false}>
        <IconLock size={14} aria-hidden="true" />
        <Text size="xs" fw={600} c="dimmed">
          {t("Shared content")}
        </Text>
        {locked && (
          <Badge size="xs" variant="light" color="gray">
            {t("Managed by template")}
          </Badge>
        )}
      </Group>
      <NodeViewContent contentEditable={contentIsEditable} />
    </NodeViewWrapper>
  );
}

export function TemplateFieldView({ node, editor }: NodeViewProps) {
  const { t } = useTranslation();
  const editorIsEditable = useEditorEditable(editor);
  const label = node.attrs.label || t("Editable field");
  const showPlaceholder =
    !node.textContent.trim() && Boolean(node.attrs.placeholder);

  return (
    <NodeViewWrapper
      data-type="templateField"
      data-template-field-id={node.attrs.fieldId ?? undefined}
      data-template-label={node.attrs.label ?? undefined}
      data-template-placeholder={node.attrs.placeholder ?? undefined}
      data-template-editable={editorIsEditable ? "true" : "false"}
      role="group"
      aria-label={label}
    >
      <Group gap={6} mb="xs" contentEditable={false}>
        <IconForms size={14} aria-hidden="true" />
        <Text size="xs" fw={600} c="dimmed">
          {label}
        </Text>
        {node.attrs.label && (
          <Badge size="xs" variant="light" color="gray">
            {t("Editable field")}
          </Badge>
        )}
      </Group>
      {showPlaceholder && (
        <Text size="sm" c="dimmed" fs="italic" contentEditable={false}>
          {node.attrs.placeholder}
        </Text>
      )}
      <NodeViewContent contentEditable={editorIsEditable} />
    </NodeViewWrapper>
  );
}
