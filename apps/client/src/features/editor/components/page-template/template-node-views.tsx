import { Badge, Group, Text } from "@mantine/core";
import { IconForms, IconLock } from "@tabler/icons-react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { useTranslation } from "react-i18next";

export function TemplateManagedBlockView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const locked = Boolean(node.attrs.locked);

  return (
    <NodeViewWrapper
      data-type="templateManagedBlock"
      data-template-locked={locked ? "true" : undefined}
      data-template-block-id={node.attrs.templateBlockId ?? undefined}
    >
      <Group gap={6} mb="xs" contentEditable={false}>
        <IconLock size={14} aria-hidden="true" />
        <Text size="xs" fw={600} c="dimmed">
          {t("Template block")}
        </Text>
        {locked && (
          <Badge size="xs" variant="light" color="gray">
            {t("Read only")}
          </Badge>
        )}
      </Group>
      <NodeViewContent contentEditable={!locked} />
    </NodeViewWrapper>
  );
}

export function TemplateFieldView({ node }: NodeViewProps) {
  const { t } = useTranslation();
  const label = node.attrs.label || t("Field to fill");
  const showPlaceholder =
    !node.textContent.trim() && Boolean(node.attrs.placeholder);

  return (
    <NodeViewWrapper
      data-type="templateField"
      data-template-field-id={node.attrs.fieldId ?? undefined}
      data-template-label={node.attrs.label ?? undefined}
      data-template-placeholder={node.attrs.placeholder ?? undefined}
    >
      <Group gap={6} mb="xs" contentEditable={false}>
        <IconForms size={14} aria-hidden="true" />
        <Text size="xs" fw={600} c="dimmed">
          {label}
        </Text>
      </Group>
      {showPlaceholder && (
        <Text size="sm" c="dimmed" fs="italic" contentEditable={false}>
          {node.attrs.placeholder}
        </Text>
      )}
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
