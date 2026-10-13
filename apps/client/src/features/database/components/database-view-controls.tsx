import {
  Button,
  Drawer,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  DatabaseFilterGroup,
  DatabaseFilterRule,
  DatabaseViewState,
} from "@docmost/api-contract";
import type { IDatabaseProperty } from "../types/database.types";
import { AccessibleActionIcon } from "@/components/ui/accessible-action-icon";
import { IconArrowDown, IconArrowUp, IconTrash } from "@tabler/icons-react";

export function DatabaseViewControls({
  state,
  properties,
  onChange,
}: {
  state: DatabaseViewState;
  properties: IDatabaseProperty[];
  onChange: (state: DatabaseViewState) => void;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(false);
  const mobile = useMediaQuery("(max-width: 767px)");
  const fields = [
    { value: "title", label: t("Title") },
    ...properties.map((property) => ({
      value: property.id,
      label: property.name,
    })),
  ];
  const filter = state.filter ?? { conjunction: "and", conditions: [] };
  const countRules = (group: DatabaseFilterGroup): number =>
    group.conditions.reduce(
      (count, item) => count + ("conjunction" in item ? countRules(item) : 1),
      0,
    );
  const content = (
    <Stack gap="md">
      <Text fw={600}>{t("Filters")}</Text>
      <FilterGroupEditor
        group={filter}
        properties={properties}
        depth={1}
        canAdd={countRules(filter) < 10}
        onChange={(next) => onChange({ ...state, filter: next })}
      />
      <Text fw={600}>{t("Sort")}</Text>
      {state.sorts.map((sort, index) => (
        <Group key={index} wrap="wrap">
          <Select
            aria-label={`${t("Sort property")} ${index + 1}`}
            data={fields.filter(
              (field) =>
                field.value === sort.propertyId ||
                !state.sorts.some((item) => item.propertyId === field.value),
            )}
            value={sort.propertyId}
            onChange={(id) =>
              id &&
              onChange({
                ...state,
                sorts: state.sorts.map((item, position) =>
                  position === index ? { ...item, propertyId: id } : item,
                ),
              })
            }
          />
          <Select
            aria-label={t("Sort direction")}
            value={sort.direction}
            data={[
              { value: "asc", label: t("Ascending") },
              { value: "desc", label: t("Descending") },
            ]}
            onChange={(direction) =>
              direction &&
              onChange({
                ...state,
                sorts: state.sorts.map((item, position) =>
                  position === index
                    ? { ...item, direction: direction as "asc" | "desc" }
                    : item,
                ),
              })
            }
          />
          <AccessibleActionIcon
            label={t("dbTable.moveUp")}
            disabled={index === 0}
            onClick={() => {
              const next = [...state.sorts];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              onChange({ ...state, sorts: next });
            }}
          >
            <IconArrowUp size={16} />
          </AccessibleActionIcon>
          <AccessibleActionIcon
            label={t("Delete")}
            onClick={() =>
              onChange({
                ...state,
                sorts: state.sorts.filter((_, position) => position !== index),
              })
            }
          >
            <IconTrash size={16} />
          </AccessibleActionIcon>
        </Group>
      ))}
      <Button
        variant="light"
        disabled={
          state.sorts.length >= 5 || state.sorts.length >= fields.length
        }
        onClick={() => {
          const field = fields.find(
            (field) =>
              !state.sorts.some((sort) => sort.propertyId === field.value),
          );
          if (field)
            onChange({
              ...state,
              sorts: [
                ...state.sorts,
                { propertyId: field.value, direction: "asc" },
              ],
            });
        }}
      >
        {t("dbTable.addSort")}
      </Button>
      <Select
        label={t("dbTable.groupBy")}
        clearable
        value={state.groupBy ?? null}
        data={properties
          .filter((property) =>
            ["select", "multi_select", "checkbox", "user"].includes(
              property.type,
            ),
          )
          .map((property) => ({ value: property.id, label: property.name }))}
        onChange={(groupBy) => onChange({ ...state, groupBy })}
      />
      <Text fw={600}>{t("Columns")}</Text>
      {properties.map((property) => (
        <Group key={property.id} justify="space-between" wrap="wrap">
          <Switch
            label={property.name}
            checked={state.visibleColumns[property.id] !== false}
            onChange={(event) =>
              onChange({
                ...state,
                visibleColumns: {
                  ...state.visibleColumns,
                  [property.id]: event.currentTarget.checked,
                },
              })
            }
          />
          <Select
            aria-label={`${t("dbTable.calculation")}: ${property.name}`}
            clearable
            value={state.calculations[property.id] ?? null}
            data={[
              "count",
              "filled",
              "empty",
              ...(property.type === "number"
                ? ["sum", "average", "min", "max"]
                : []),
              ...(property.type === "date" ? ["earliest", "latest"] : []),
            ].map((value) => ({ value, label: t(`dbTable.${value}`) }))}
            onChange={(value) => {
              const calculations = { ...state.calculations };
              if (value) calculations[property.id] = value as any;
              else delete calculations[property.id];
              onChange({ ...state, calculations });
            }}
          />
        </Group>
      ))}
      <Button
        variant="subtle"
        onClick={() =>
          onChange({
            version: 2,
            sorts: [],
            filter: { conjunction: "and", conditions: [] },
            visibleColumns: {},
            calculations: {},
            groupBy: null,
          })
        }
      >
        {t("Reset")}
      </Button>
    </Stack>
  );
  return (
    <>
      <Button variant="default" onClick={() => setOpened(true)}>
        {t("dbTable.viewSettings")} ({countRules(filter) + state.sorts.length})
      </Button>
      <Drawer
        opened={opened}
        onClose={() => setOpened(false)}
        title={t("dbTable.viewSettings")}
        closeButtonProps={{ "aria-label": t("Close") }}
        position={mobile ? "bottom" : "right"}
        size={mobile ? "85dvh" : "lg"}
      >
        {content}
      </Drawer>
    </>
  );
}

function FilterGroupEditor({
  group,
  properties,
  depth,
  canAdd,
  onChange,
}: {
  group: DatabaseFilterGroup;
  properties: IDatabaseProperty[];
  depth: number;
  canAdd: boolean;
  onChange: (group: DatabaseFilterGroup) => void;
}) {
  const { t } = useTranslation();
  const update = (
    index: number,
    condition: DatabaseFilterGroup | DatabaseFilterRule,
  ) =>
    onChange({
      ...group,
      conditions: group.conditions.map((item, position) =>
        position === index ? condition : item,
      ),
    });
  return (
    <Paper withBorder p="sm">
      <Stack gap="xs">
        <Select
          aria-label={t("dbTable.filterConjunction")}
          data={[
            { value: "and", label: t("dbTable.and") },
            { value: "or", label: t("dbTable.or") },
          ]}
          value={group.conjunction}
          onChange={(value) =>
            value && onChange({ ...group, conjunction: value as "and" | "or" })
          }
        />
        {group.conditions.map((condition, index) => (
          <Stack key={index} gap="xs">
            {"conjunction" in condition ? (
              <FilterGroupEditor
                group={condition}
                properties={properties}
                depth={depth + 1}
                canAdd={canAdd}
                onChange={(next) => update(index, next)}
              />
            ) : (
              <FilterRuleEditor
                rule={condition}
                properties={properties}
                onChange={(next) => update(index, next)}
              />
            )}
            <Button
              size="compact-xs"
              variant="subtle"
              color="red"
              onClick={() =>
                onChange({
                  ...group,
                  conditions: group.conditions.filter(
                    (_, position) => position !== index,
                  ),
                })
              }
            >
              {t("Delete")}
            </Button>
          </Stack>
        ))}
        <Group>
          <Button
            size="xs"
            variant="light"
            disabled={!canAdd}
            onClick={() =>
              onChange({
                ...group,
                conditions: [
                  ...group.conditions,
                  { propertyId: "title", operator: "contains", value: "" },
                ],
              })
            }
          >
            {t("Add filter")}
          </Button>
          {depth < 2 && (
            <Button
              size="xs"
              variant="subtle"
              disabled={!canAdd}
              onClick={() =>
                onChange({
                  ...group,
                  conditions: [
                    ...group.conditions,
                    {
                      conjunction: "or",
                      conditions: [
                        {
                          propertyId: "title",
                          operator: "contains",
                          value: "",
                        },
                      ],
                    },
                  ],
                })
              }
            >
              {t("dbTable.addFilterGroup")}
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

function FilterRuleEditor({
  rule,
  properties,
  onChange,
}: {
  rule: DatabaseFilterRule;
  properties: IDatabaseProperty[];
  onChange: (rule: DatabaseFilterRule) => void;
}) {
  const { t } = useTranslation();
  const property = properties.find(
    (property) => property.id === rule.propertyId,
  );
  const typed = property?.type === "number" || property?.type === "date";
  const operators = [
    "equals",
    "not_equals",
    "is_empty",
    "is_not_empty",
    ...(typed
      ? ["gt", "gte", "lt", "lte", "between"]
      : property?.type === "checkbox"
        ? []
        : ["contains", "not_contains"]),
  ];
  const valueEditor = (
    value: unknown,
    change: (value: unknown) => void,
    suffix = "",
  ) =>
    property?.type === "number" ? (
      <NumberInput
        aria-label={`${t("Value")}${suffix}`}
        value={
          typeof value === "number" || typeof value === "string" ? value : ""
        }
        onChange={change}
      />
    ) : property?.type === "checkbox" ? (
      <Select
        aria-label={t("Value")}
        data={[
          { value: "true", label: t("Checked") },
          { value: "false", label: t("Unchecked") },
        ]}
        value={String(value)}
        onChange={change}
      />
    ) : property?.type === "select" || property?.type === "multi_select" ? (
      <Select
        aria-label={t("Value")}
        data={(property.settings as any)?.options ?? []}
        value={typeof value === "string" ? value : null}
        onChange={change}
      />
    ) : (
      <TextInput
        aria-label={`${t("Value")}${suffix}`}
        type={property?.type === "date" ? "date" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => change(event.currentTarget.value)}
      />
    );
  return (
    <Stack gap="xs">
      <Group grow wrap="wrap">
        <Select
          aria-label={t("Filter field")}
          value={rule.propertyId}
          data={[
            { value: "title", label: t("Title") },
            ...properties.map((property) => ({
              value: property.id,
              label: property.name,
            })),
          ]}
          onChange={(id) =>
            id &&
            onChange({
              propertyId: id,
              operator: "equals",
              value:
                properties.find((property) => property.id === id)?.type ===
                "number"
                  ? 0
                  : "",
            })
          }
        />
        <Select
          aria-label={t("dbTable.operator")}
          data={operators.map((value) => ({
            value,
            label: t(`dbTable.${value}`),
          }))}
          value={rule.operator}
          onChange={(operator) =>
            operator &&
            onChange({
              ...rule,
              operator: operator as any,
              value: operator === "between" ? ["", ""] : "",
            })
          }
        />
      </Group>
      {!["is_empty", "is_not_empty"].includes(rule.operator) &&
        (rule.operator === "between" ? (
          <Group grow>
            {[0, 1].map((index) => (
              <div key={index}>
                {valueEditor(
                  (rule.value as any)?.[index],
                  (value) => {
                    const next = Array.isArray(rule.value)
                      ? [...rule.value]
                      : ["", ""];
                    next[index] = value;
                    onChange({ ...rule, value: next });
                  },
                  ` ${index + 1}`,
                )}
              </div>
            ))}
          </Group>
        ) : (
          valueEditor(rule.value, (value) => onChange({ ...rule, value }))
        ))}
    </Stack>
  );
}
