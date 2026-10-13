import {
  Alert,
  Button,
  Modal,
  NumberInput,
  Select,
  Stack,
  TextInput,
} from "@mantine/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DatabaseNumberPropertySettings } from "@docmost/api-contract";
import type { IDatabaseProperty } from "../types/database.types";

export function NumberPropertySettingsModal({
  property,
  onClose,
  onSave,
}: {
  property: IDatabaseProperty | null;
  onClose: () => void;
  onSave: (settings: DatabaseNumberPropertySettings) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<DatabaseNumberPropertySettings>({
    format: "number",
    precision: 2,
  });
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (property)
      setSettings({
        format: "number",
        precision: 2,
        ...(property.settings as any),
      });
  }, [property?.id]);
  return (
    <Modal
      opened={Boolean(property)}
      onClose={onClose}
      title={property?.name}
      closeButtonProps={{ "aria-label": t("Close") }}
    >
      <Stack>
        <Select
          label={t("dbTable.numberFormat")}
          value={settings.format}
          data={["number", "percent", "currency"].map((value) => ({
            value,
            label: t(`dbTable.${value}`),
          }))}
          onChange={(value) =>
            value &&
            setSettings({
              ...settings,
              format: value as any,
              ...(value === "currency"
                ? { currency: settings.currency ?? "USD" }
                : {}),
            })
          }
        />
        {settings.format === "currency" && (
          <TextInput
            label={t("dbTable.currency")}
            maxLength={3}
            value={settings.currency ?? "USD"}
            onChange={(event) =>
              setSettings({
                ...settings,
                currency: event.currentTarget.value.toUpperCase(),
              })
            }
          />
        )}
        <NumberInput
          label={t("dbTable.precision")}
          min={0}
          max={10}
          allowDecimal={false}
          value={settings.precision ?? 2}
          onChange={(value) =>
            setSettings({ ...settings, precision: Number(value) })
          }
        />
        {failed && <Alert color="red">{t("dbTable.error")}</Alert>}
        <Button
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
      </Stack>
    </Modal>
  );
}
