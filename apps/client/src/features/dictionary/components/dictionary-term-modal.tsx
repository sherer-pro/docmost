import {
  Button,
  Group,
  Modal,
  Stack,
  TagsInput,
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
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput
            label={t("Term")}
            withAsterisk
            {...form.getInputProps("term")}
          />

          <TagsInput
            label={t("Word forms")}
            placeholder={t("Add word form")}
            clearable
            {...form.getInputProps("forms")}
          />

          <Textarea
            label={t("Definition")}
            description={t("Markdown is supported")}
            withAsterisk
            autosize
            minRows={5}
            maxRows={12}
            {...form.getInputProps("definitionMarkdown")}
          />

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
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
