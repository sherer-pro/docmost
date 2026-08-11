import {
  Button,
  Group,
  Modal,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
} from "@mantine/core";
import { useForm, zodResolver } from "@mantine/form";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";
import {
  useCreateDictionaryTermMutation,
  useUpdateDictionaryTermMutation,
} from "@/features/dictionary/queries/dictionary-query";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import { DictionaryMarkdown } from "./dictionary-markdown";
import classes from "./dictionary.module.css";

interface DictionaryTermModalProps {
  opened: boolean;
  onClose: () => void;
  spaceId: string;
  initialTerm?: string;
  term?: IDictionaryTerm | null;
}

const formSchema = z.object({
  term: z.string().trim().min(1).max(255),
  forms: z.array(z.string().trim().max(255)).max(100),
  definitionMarkdown: z.string().trim().min(1).max(20000),
});

type FormValues = z.infer<typeof formSchema>;

export function DictionaryTermModal({
  opened,
  onClose,
  spaceId,
  initialTerm = "",
  term,
}: DictionaryTermModalProps) {
  const { t } = useTranslation();
  const createMutation = useCreateDictionaryTermMutation(spaceId);
  const updateMutation = useUpdateDictionaryTermMutation(spaceId);
  const isEditing = Boolean(term?.id);

  const form = useForm<FormValues>({
    validate: zodResolver(formSchema),
    initialValues: {
      term: "",
      forms: [],
      definitionMarkdown: "",
    },
  });

  useEffect(() => {
    if (!opened) {
      return;
    }

    form.setValues({
      term: term?.term ?? initialTerm,
      forms: term?.forms ?? [],
      definitionMarkdown: term?.definitionMarkdown ?? "",
    });
    form.resetDirty();
  }, [opened, term?.id, initialTerm]);

  const handleSubmit = async (values: FormValues) => {
    const payload = {
      term: values.term.trim(),
      forms: values.forms.map((formValue) => formValue.trim()).filter(Boolean),
      definitionMarkdown: values.definitionMarkdown.trim(),
    };

    if (isEditing && term) {
      await updateMutation.mutateAsync({ termId: term.id, payload });
    } else {
      await createMutation.mutateAsync({ spaceId, ...payload });
    }

    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEditing ? t("Edit dictionary term") : t("Add dictionary term")}
      size="lg"
      closeButtonProps={{ "aria-label": t("Close"), size: 32 }}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t("Term")}
            description={t(
              "Use the main spelling that should appear in the dictionary.",
            )}
            placeholder={t("Enter a term")}
            withAsterisk
            {...form.getInputProps("term")}
          />

          <TagsInput
            label={t("Word forms")}
            description={t("Add aliases, abbreviations, or inflected forms.")}
            placeholder={t("Separate forms with commas, semicolons, or Enter")}
            splitChars={[",", ";", "\n"]}
            clearable
            {...form.getInputProps("forms")}
          />

          <Textarea
            label={t("Definition")}
            description={t("Markdown is supported")}
            placeholder={t("Write the definition in Markdown")}
            withAsterisk
            autosize
            minRows={5}
            maxRows={12}
            {...form.getInputProps("definitionMarkdown")}
          />

          <div className={classes.definitionPreview}>
            <Text size="sm" fw={500} mb="xs">
              {t("Preview")}
            </Text>
            {form.values.definitionMarkdown.trim() ? (
              <DictionaryMarkdown markdown={form.values.definitionMarkdown} />
            ) : (
              <Text size="sm" c="dimmed">
                {t("Definition preview will appear here.")}
              </Text>
            )}
          </div>

          <Group justify="flex-end">
            <Button type="button" variant="default" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending || updateMutation.isPending}
            >
              {t("Save")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
