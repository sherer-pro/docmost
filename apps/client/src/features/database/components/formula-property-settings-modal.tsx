import {
  Alert,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  Textarea,
} from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DATABASE_FORMULA_FUNCTIONS,
  validateDatabaseFormulaSchema,
  type DatabaseFormulaSettings,
} from "@docmost/api-contract";
import type { IDatabaseProperty } from "../types/database.types";
import {
  classifyFormulaValidationError,
  formulaValidationKeys,
} from "../utils/formula-validation-error";

export function FormulaPropertySettingsModal({
  opened,
  title,
  propertyId,
  initialSettings,
  properties,
  onClose,
  onSave,
}: {
  opened: boolean;
  title: string;
  propertyId?: string;
  initialSettings?: DatabaseFormulaSettings;
  properties: IDatabaseProperty[];
  onClose: () => void;
  onSave: (settings: DatabaseFormulaSettings) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draftId] = useState(() => crypto.randomUUID());
  const [settings, setSettings] = useState<DatabaseFormulaSettings>({
    languageVersion: 1,
    expression: "0",
    resultType: "number",
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (opened) {
      setSettings(
        initialSettings ?? {
          languageVersion: 1,
          expression: "0",
          resultType: "number",
        },
      );
      setFailed(false);
    }
  }, [opened, propertyId]);
  const invalid = useMemo(() => {
    try {
      validateDatabaseFormulaSchema([
        ...properties.filter((property) => property.id !== propertyId),
        { id: propertyId ?? draftId, type: "formula", settings },
      ]);
      return null;
    } catch (error) {
      return classifyFormulaValidationError(error);
    }
  }, [properties, propertyId, draftId, settings]);
  const invalidMessage = invalid
    ? t(formulaValidationKeys[invalid.code], invalid.params)
    : undefined;
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <Stack>
        <Select
          label={t("dbTable.formulaResultType")}
          value={settings.resultType}
          data={["number", "text", "date", "checkbox"].map((value) => ({
            value,
            label: t(
              value === "text"
                ? "Text"
                : value === "checkbox"
                  ? "Checkbox"
                  : `dbTable.${value}`,
            ),
          }))}
          onChange={(value) =>
            value &&
            setSettings({
              ...settings,
              resultType: value as DatabaseFormulaSettings["resultType"],
            })
          }
        />
        <Select
          label={t("dbTable.insertProperty")}
          value={null}
          searchable
          clearable
          data={[
            { value: "title", label: t("Title") },
            ...properties
              .filter(
                (property) =>
                  property.id !== propertyId &&
                  ![
                    "file",
                    "user",
                    "updated_by",
                    "page_reference",
                    "multi_select",
                  ].includes(property.type),
              )
              .map((property) => ({
                value: property.id,
                label: property.name,
              })),
          ]}
          onChange={(id) =>
            id &&
            setSettings({
              ...settings,
              expression: `${settings.expression === "0" ? "" : settings.expression}prop(${JSON.stringify(id)})`,
            })
          }
        />
        <Textarea
          label={t("dbTable.formulaExpression")}
          minRows={4}
          maxLength={4096}
          autosize
          value={settings.expression}
          onChange={(event) =>
            setSettings({ ...settings, expression: event.currentTarget.value })
          }
          error={invalidMessage}
          styles={{ input: { fontFamily: "monospace" } }}
        />
        <Text size="sm" c="dimmed">
          {t("dbTable.formulaHelp")}
        </Text>
        <Text size="xs" ff="monospace">
          {DATABASE_FORMULA_FUNCTIONS.join(", ")}
        </Text>
        {failed && <Alert color="red">{t("dbTable.error")}</Alert>}
        <Group justify="end">
          <Button variant="default" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={Boolean(invalid)}
            loading={pending}
            onClick={async () => {
              setPending(true);
              setFailed(false);
              try {
                await onSave(settings);
                onClose();
              } catch {
                setFailed(true);
              } finally {
                setPending(false);
              }
            }}
          >
            {t("Save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
