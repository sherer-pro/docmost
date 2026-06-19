import { Text } from "@mantine/core";
import { modals } from "@mantine/modals";

interface DictionaryImportConfirmationOptions {
  fileName: string;
  termCount: number;
  t: (
    key: string,
    options?: Record<string, string | number | boolean>,
  ) => string;
  onConfirm: () => void | Promise<void>;
}

export function openDictionaryImportConfirmModal({
  fileName,
  termCount,
  t,
  onConfirm,
}: DictionaryImportConfirmationOptions) {
  modals.openConfirmModal({
    title: t("Import dictionary terms"),
    children: (
      <Text size="sm">
        {t(
          "Import {{count}} terms from {{fileName}}? Existing terms with the same main term will be updated.",
          {
            count: termCount,
            fileName,
          },
        )}
      </Text>
    ),
    labels: { confirm: t("Import"), cancel: t("Cancel") },
    onConfirm,
  });
}
