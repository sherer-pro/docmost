import { Checkbox, Group, Paper, Stack } from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import type {
  AiBuiltinToolCapability,
  AiBuiltinToolCatalogEntry,
  AiBuiltinToolCategory,
} from "@docmost/api-contract";
import { useTranslation } from "react-i18next";
import { CopyButton } from "@/components/common/copy-button.tsx";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon.tsx";

export function AiToolCapabilityList({
  catalog,
  allowed,
  available,
  exposure,
  disabled,
  onChange,
}: {
  catalog: AiBuiltinToolCatalogEntry[];
  allowed: AiBuiltinToolCapability[];
  available?: AiBuiltinToolCapability[];
  exposure?: "agent" | "mcp";
  disabled?: boolean;
  onChange: (capabilities: AiBuiltinToolCapability[]) => void;
}) {
  const { t } = useTranslation();
  const allowedSet = new Set(allowed);
  const availableSet = available ? new Set(available) : null;
  const visible = catalog.filter(
    (tool) =>
      (!exposure || tool.exposures.includes(exposure)) &&
      (!availableSet || availableSet.has(tool.capability)),
  );
  const groups = new Map<AiBuiltinToolCategory, AiBuiltinToolCatalogEntry[]>();
  for (const tool of visible) {
    const items = groups.get(tool.category) ?? [];
    items.push(tool);
    groups.set(tool.category, items);
  }

  const updateCategory = (
    tools: AiBuiltinToolCatalogEntry[],
    checked: boolean,
  ) => {
    const next = new Set(allowed);
    for (const tool of tools) {
      if (checked) next.add(tool.capability);
      else next.delete(tool.capability);
    }
    onChange([...next]);
  };

  return (
    <Stack gap="sm">
      {[...groups.entries()].map(([category, tools]) => {
        const selected = tools.filter((tool) =>
          allowedSet.has(tool.capability),
        ).length;
        return (
          <Paper key={category} withBorder radius="md" p="sm">
            <Checkbox
              label={t(`ai.toolPolicy.category.${category}`)}
              description={t("ai.toolPolicy.categorySelection", {
                selected,
                total: tools.length,
              })}
              checked={selected === tools.length && tools.length > 0}
              indeterminate={selected > 0 && selected < tools.length}
              disabled={disabled}
              onChange={(event) =>
                updateCategory(tools, event.currentTarget.checked)
              }
            />
            <Stack gap={6} mt="sm" pl="md">
              {tools.map((tool) => (
                <Group
                  key={tool.capability}
                  justify="space-between"
                  wrap="nowrap"
                >
                  <Checkbox
                    size="xs"
                    label={t(`ai.toolPolicy.tool.${tool.name}`)}
                    checked={allowedSet.has(tool.capability)}
                    disabled={disabled}
                    onChange={(event) => {
                      const next = new Set(allowed);
                      if (event.currentTarget.checked)
                        next.add(tool.capability);
                      else next.delete(tool.capability);
                      onChange([...next]);
                    }}
                  />
                  <CopyButton value={tool.capability} timeout={2000}>
                    {({ copied, copy }) => {
                      const label = copied
                        ? t("Copied")
                        : t("ai.toolPolicy.copyCapabilityIdentifier", {
                            capability: tool.capability,
                          });

                      return (
                        <AccessibleActionIcon
                          variant="subtle"
                          color={copied ? "teal" : "gray"}
                          label={label}
                          tooltip={label}
                          tooltipProps={{ withArrow: true, position: "left" }}
                          onClick={copy}
                        >
                          {copied ? (
                            <IconCheck size={16} />
                          ) : (
                            <IconCopy size={16} />
                          )}
                        </AccessibleActionIcon>
                      );
                    }}
                  </CopyButton>
                </Group>
              ))}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
