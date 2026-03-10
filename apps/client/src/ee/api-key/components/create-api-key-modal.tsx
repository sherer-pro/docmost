import { lazy, Suspense, useState } from "react";
import { Modal, TextInput, Button, Group, Stack, Select } from "@mantine/core";
import { useForm } from "@mantine/form";
import { zodResolver } from "mantine-form-zod-resolver";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useCreateApiKeyMutation } from "@/ee/api-key/queries/api-key-query";
import { IconCalendar } from "@tabler/icons-react";
import { IApiKey } from "@/ee/api-key";
import { useGetSpacesQuery } from "@/features/space/queries/space-query.ts";
import { useEffect } from "react";

const DateInput = lazy(() =>
  import("@mantine/dates").then((module) => ({
    default: module.DateInput,
  })),
);

interface CreateApiKeyModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: (response: IApiKey) => void;
}

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  spaceId: z.string().uuid("Space is required"),
  expiresAt: z.string().optional(),
});
type FormValues = z.infer<typeof formSchema>;

export function CreateApiKeyModal({
  opened,
  onClose,
  onSuccess,
}: CreateApiKeyModalProps) {
  const { t } = useTranslation();
  const [expirationOption, setExpirationOption] = useState<string>("never");
  const createApiKeyMutation = useCreateApiKeyMutation();
  const { data: spacesData, isLoading: isSpacesLoading } = useGetSpacesQuery({
    limit: 200,
  });

  const form = useForm<FormValues>({
    validate: zodResolver(formSchema),
    initialValues: {
      name: "",
      spaceId: "",
      expiresAt: "",
    },
  });

  useEffect(() => {
    if (!opened) {
      return;
    }

    if (form.values.spaceId || !spacesData?.items?.length) {
      return;
    }

    form.setFieldValue("spaceId", spacesData.items[0].id);
  }, [opened, spacesData?.items, form.values.spaceId]);

  const spaceOptions =
    spacesData?.items?.map((space) => ({
      value: space.id,
      label: space.name || space.slug,
    })) || [];

  const getExpirationDate = (): string | undefined => {
    if (expirationOption === "never") {
      return undefined;
    }
    if (expirationOption === "custom") {
      if (!form.values.expiresAt) {
        return undefined;
      }

      const customDate = new Date(form.values.expiresAt);
      if (Number.isNaN(customDate.getTime())) {
        return undefined;
      }

      return customDate.toISOString();
    }
    const days = parseInt(expirationOption);
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString();
  };

  const getExpirationLabel = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const formatted = date.toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
    return `${days} days (${formatted})`;
  };

  const expirationOptions = [
    { value: "never", label: t("No expiration") },
    { value: "30", label: getExpirationLabel(30) },
    { value: "60", label: getExpirationLabel(60) },
    { value: "90", label: getExpirationLabel(90) },
    { value: "365", label: getExpirationLabel(365) },
    { value: "custom", label: t("Custom") },
  ];

  const handleSubmit = async (data: {
    name?: string;
    spaceId?: string;
    expiresAt?: string | Date;
  }) => {
    const expiresAt = getExpirationDate();
    if (expirationOption === "custom" && !expiresAt) {
      form.setFieldError("expiresAt", t("Custom expiration date is required"));
      return;
    }

    const requestPayload = {
      name: data.name,
      spaceId: data.spaceId,
      expiresAt,
    };

    try {
      const createdKey =
        await createApiKeyMutation.mutateAsync(requestPayload);
      onSuccess(createdKey);
      form.reset();
      onClose();
    } catch (err) {
      //
    }
  };

  const handleClose = () => {
    form.reset();
    setExpirationOption("never");
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={t("Create API Key")}
      size="md"
    >
      <form onSubmit={form.onSubmit((values) => handleSubmit(values))}>
        <Stack gap="md">
          <TextInput
            label={t("Name")}
            placeholder={t("Enter a descriptive name")}
            data-autofocus
            required
            {...form.getInputProps("name")}
          />

          <Select
            label={t("Space")}
            placeholder={t("Select a space")}
            data={spaceOptions}
            value={form.values.spaceId}
            onChange={(value) => form.setFieldValue("spaceId", value || "")}
            searchable
            allowDeselect={false}
            required
            disabled={isSpacesLoading || spaceOptions.length === 0}
            error={form.errors.spaceId}
          />

          <Select
            label={t("Expiration")}
            data={expirationOptions}
            value={expirationOption}
            onChange={(value) => setExpirationOption(value || "never")}
            leftSection={<IconCalendar size={16} />}
            allowDeselect={false}
          />

          {expirationOption === "custom" && (
            <Suspense fallback={null}>
              <DateInput
                label={t("Custom expiration date")}
                placeholder={t("Select expiration date")}
                minDate={new Date()}
                {...form.getInputProps("expiresAt")}
              />
            </Suspense>
          )}

          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={handleClose}>
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              loading={createApiKeyMutation.isPending}
              disabled={spaceOptions.length === 0}
            >
              {t("Create")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
