import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { Button, Group, Modal, Paper, Stack, TextInput } from "@mantine/core";
import { IconForms, IconLock, IconPencil } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

export function TemplateBlockToolbar({ editor }: { editor: Editor }) {
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
    setLabel(state?.inField ? state.fieldLabel ?? "" : "");
    setPlaceholder(state?.inField ? state.fieldPlaceholder ?? "" : "");
  }, [fieldModalOpened, state?.fieldLabel, state?.fieldPlaceholder, state?.inField]);

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
        p="xs"
        mb="sm"
        style={{ position: "sticky", top: 8, zIndex: 8 }}
        role="toolbar"
        aria-label={t("Template block tools")}
      >
        <Group gap="xs">
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconLock size={15} />}
            onClick={() =>
              editor.chain().focus().insertTemplateManagedBlock().run()
            }
          >
            {t("Add template block")}
          </Button>
          <Button
            size="xs"
            variant={state?.inField ? "light" : "subtle"}
            leftSection={
              state?.inField ? <IconPencil size={15} /> : <IconForms size={15} />
            }
            onClick={() => setFieldModalOpened(true)}
          >
            {state?.inField
              ? t("Edit field")
              : state?.inManagedBlock
                ? t("Convert to field")
                : t("Add field")}
          </Button>
          {state?.inField && (
            <Button
              size="xs"
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
              {t("Convert to template block")}
            </Button>
          )}
        </Group>
      </Paper>

      <Modal
        opened={fieldModalOpened}
        onClose={() => setFieldModalOpened(false)}
        title={state?.inField ? t("Edit field") : t("Create field")}
        centered
      >
        <Stack>
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
            <Button variant="default" onClick={() => setFieldModalOpened(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={saveField}>{t("Save field")}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
