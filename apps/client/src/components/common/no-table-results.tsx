import { Box, Stack, Table, Text } from "@mantine/core";
import { IconSearchOff } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";

interface NoTableResultsProps {
  colSpan: number;
  text?: string;
  description?: string;
}

export default function NoTableResults({
  colSpan,
  text,
  description,
}: NoTableResultsProps) {
  const { t } = useTranslation();

  return (
    <Table.Tr>
      <Table.Td colSpan={colSpan}>
        <Box py="xl">
          <Stack align="center" gap={6}>
            <IconSearchOff
              size={28}
              stroke={1.6}
              color="var(--mantine-color-dimmed)"
            />
            <Text fw={500} ta="center">
              {text || t("No results found...")}
            </Text>
            {description && (
              <Text size="sm" c="dimmed" ta="center" maw={320}>
                {description}
              </Text>
            )}
          </Stack>
        </Box>
      </Table.Td>
    </Table.Tr>
  );
}
