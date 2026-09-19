import {
  Group,
  Box,
  Button,
  TextInput,
  Stack,
  Textarea,
  Text,
} from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSettingsDirty, SettingsSaveBar } from "./settings/settings-draft";
import { useForm, zodResolver } from "@mantine/form";
import * as z from "zod";
import { useUpdateSpaceMutation } from "@/features/space/queries/space-query.ts";
import { ISpace } from "@/features/space/types/space.types.ts";
import { useTranslation } from "react-i18next";

const formSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500),
  slug: z
    .string()
    .min(2)
    .max(100)
    .regex(
      /^[a-zA-Z0-9]+$/,
      "Space slug must be alphanumeric. No special characters",
    ),
});

type FormValues = z.infer<typeof formSchema>;
interface EditSpaceFormProps {
  space: ISpace;
  readOnly?: boolean;
}
export function EditSpaceForm({ space, readOnly }: EditSpaceFormProps) {
  const { t } = useTranslation();
  const updateSpaceMutation = useUpdateSpaceMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const [saveError, setSaveError] = useState(false);

  const form = useForm<FormValues>({
    validate: zodResolver(formSchema),
    initialValues: {
      name: space?.name,
      description: space?.description || "",
      slug: space.slug,
    },
  });

  const release = useSettingsDirty(form.isDirty());
  useEffect(() => {
    if (!form.isDirty()) {
      const values = {
        name: space.name,
        description: space.description || "",
        slug: space.slug,
      };
      form.setValues(values);
      form.resetDirty(values);
    }
  }, [space.name, space.description, space.slug]);

  const handleSubmit = async (values: {
    name?: string;
    description?: string;
    slug?: string;
  }) => {
    const spaceData: Partial<ISpace> = {
      spaceId: space.id,
    };
    if (form.isDirty("name")) {
      spaceData.name = values.name;
    }
    if (form.isDirty("description")) {
      spaceData.description = values.description;
    }

    if (form.isDirty("slug")) {
      spaceData.slug = values.slug;
    }

    setSaveError(false);
    try {
      const saved = await updateSpaceMutation.mutateAsync(spaceData);
      const savedValues = {
        name: saved.name,
        description: saved.description || "",
        slug: saved.slug,
      };
      form.setValues(savedValues);
      form.resetDirty(savedValues);
      release();
      if (saved.slug !== space.slug)
        navigate(`/settings/spaces/${encodeURIComponent(saved.slug)}/general`, {
          replace: true,
          state: location.state,
        });
    } catch {
      setSaveError(true);
    }
  };

  return (
    <>
      <Box>
        <form onSubmit={form.onSubmit((values) => handleSubmit(values))}>
          <Stack>
            <TextInput
              id="name"
              label={t("Space name")}
              placeholder={t("e.g Sales")}
              variant="filled"
              readOnly={readOnly}
              disabled={updateSpaceMutation.isPending}
              {...form.getInputProps("name")}
            />

            <TextInput
              id="slug"
              label={t("spaceAdmin.spaceAddress")}
              description={`${window.location.origin}/s/${form.values.slug}`}
              variant="filled"
              readOnly={readOnly}
              disabled={updateSpaceMutation.isPending}
              {...form.getInputProps("slug")}
            />

            <Textarea
              id="description"
              label={t("Description")}
              placeholder={t("e.g Space for sales team to collaborate")}
              variant="filled"
              readOnly={readOnly}
              disabled={updateSpaceMutation.isPending}
              autosize
              minRows={1}
              maxRows={3}
              {...form.getInputProps("description")}
            />
          </Stack>

          {!readOnly && (
            <SettingsSaveBar
              dirty={form.isDirty()}
              pending={updateSpaceMutation.isPending}
              error={saveError}
              onCancel={() => {
                form.setValues({
                  name: space.name,
                  description: space.description || "",
                  slug: space.slug,
                });
                form.resetDirty();
                setSaveError(false);
                release();
              }}
            />
          )}
        </form>
      </Box>
    </>
  );
}
