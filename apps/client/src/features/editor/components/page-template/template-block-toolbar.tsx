import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  Button,
  Group,
  Menu,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconForms,
  IconLock,
  IconPencil,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

export function TemplateBlockToolbar({
  editor,
  className,
}: {
  editor: Editor;
  className?: string;
}) {
  const { t } = useTranslation();
  const [fieldModalOpened, setFieldModalOpened] = useState(false);
  const [label, setLabel] = useState("");
  const [placeholder, setPlaceholder] = useState("");
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      inManagedBlock: current.isActive("templateManagedBlock"),
      inField: current.isActive("templateField"),
      fieldLabel: current.getAttributes("templateField").label as string | null,
      fieldPlaceholder: current.getAttributes("templateField").placeholder as
        | string
        | null,
    }),
  });

  useEffect(() => {
    if (!fieldModalOpened) return;
    setLabel(state?.inField ? (state.fieldLabel ?? "") : "");
    setPlaceholder(state?.inField ? (state.fieldPlaceholder ?? "") : "");
  }, [
    fieldModalOpened,
    state?.fieldLabel,
    state?.fieldPlaceholder,
    state?.inField,
  ]);

  const saveField = () => {
    if (state?.inField) {
      editor
        .chain()
        .focus()
        .updateAttributes("templateField", {
          label: label.trim() || null,
          placeholder: placeholder.trim() || null,
        })
        .run();
    } else if (state?.inManagedBlock) {
      editor
        .chain()
        .focus()
        .convertTemplateManagedBlockToField({
          label: label.trim() || null,
          placeholder: placeholder.trim() || null,
        })
        .run();
    } else {
      editor
        .chain()
        .focus()
        .insertTemplateField({
          label: label.trim() || null,
          placeholder: placeholder.trim() || null,
        })
        .run();
    }
    setFieldModalOpened(false);
  };

  return (
    <>
      <Paper
        withBorder
        radius="md"
        p="sm"
        mb="sm"
        className={clsx(className)}
        style={{ position: "sticky", top: 8, zIndex: 8 }}
        role="toolbar"
        aria-label={t("Template content")}
      >
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <Stack gap={2} style={{ flex: "1 1 20rem", minWidth: 0 }}>
            <Text size="sm" fw={600}>
              {t("Template content")}
            </Text>
            <Text size="xs" c="dimmed">
              {t(
                "Published template blocks update every linked page while fields keep local values.",
              )}
            </Text>
          </Stack>

          <Group gap="xs" wrap="wrap">
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <Button
                  size="compact-sm"
                  variant="default"
                >
                  {t("Add to template")}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  leftSection={<IconLock size={15} />}
                  onClick={() =>
                    editor.chain().focus().insertTemplateManagedBlock().run()
                  }
                >
                  <Text size="sm" fw={600}>
                    {t("Shared content")}
                  </Text>
                  <Text size="xs" c="dimmed" maw={280}>
                    {t(
                      "They are edited only in the template and appear read-only on linked pages.",
                    )}
                  </Text>
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconForms size={15} />}
                  onClick={() => setFieldModalOpened(true)}
                >
                  <Text size="sm" fw={600}>
                    {t("Editable field")}
                  </Text>
                  <Text size="xs" c="dimmed" maw={280}>
                    {t(
                      "People fill these on linked pages. Their values survive every publication.",
                    )}
                  </Text>
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>

            {state?.inManagedBlock && (
              <Button
                size="compact-sm"
                variant="subtle"
                leftSection={<IconForms size={15} />}
                onClick={() => setFieldModalOpened(true)}
              >
                {t("Make editable on each page")}
              </Button>
            )}
            {state?.inField && (
              <Button
                size="compact-sm"
                variant="subtle"
                leftSection={<IconPencil size={15} />}
                onClick={() => setFieldModalOpened(true)}
              >
                {t("Field settings")}
              </Button>
            )}
            {state?.inField && (
              <Button
                size="compact-sm"
                variant="subtle"
                color="gray"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .convertTemplateFieldToManagedBlock()
                    .run()
                }
              >
                {t("Make shared on every page")}
              </Button>
            )}
          </Group>
        </Group>
      </Paper>

      <Modal
        opened={fieldModalOpened}
        onClose={() => setFieldModalOpened(false)}
        title={
          state?.inField
            ? t("Field settings")
            : state?.inManagedBlock
              ? t("Make editable on each page")
              : t("Editable field")
        }
        centered
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t(
              "People fill these on linked pages. Their values survive every publication.",
            )}
          </Text>
          <TextInput
            label={t("Field name")}
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
            placeholder={t("For example: Project owner")}
            autoFocus
          />
          <TextInput
            label={t("Placeholder")}
            value={placeholder}
            onChange={(event) => setPlaceholder(event.currentTarget.value)}
            placeholder={t("What should be entered here?")}
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => setFieldModalOpened(false)}
            >
              {t("Cancel")}
            </Button>
            <Button onClick={saveField}>{t("Save field")}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
