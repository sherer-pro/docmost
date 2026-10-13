import {
  formatDatabaseLocalTime,
  parseDatabaseLocalTime,
} from "../utils/database-date";
import {
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Switch,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DatabaseDateValue } from "@docmost/api-contract";
import type { IDatabaseProperty } from "../types/database.types";

export function DatabaseValueEditor({
  property,
  value,
  onChange,
  onSave,
  onBlur,
  autoFocus = false,
  label,
}: {
  property: IDatabaseProperty;
  value: unknown;
  onChange: (value: unknown) => void;
  onSave?: (value: unknown) => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  label?: string;
}) {
  const ariaLabel = label ?? property.name;
  if (property.type === "date")
    return (
      <DatabaseDateEditor
        value={value}
        onChange={onChange}
        onSave={onSave}
        label={ariaLabel}
        autoFocus={autoFocus}
      />
    );
  if (property.type === "multi_select")
    return (
      <MultiSelect
        aria-label={ariaLabel}
        searchable
        clearable
        autoFocus={autoFocus}
        value={Array.isArray(value) ? value : []}
        data={
          "options" in (property.settings ?? {})
            ? (property.settings as any).options
            : []
        }
        onChange={(next) => {
          onChange(next);
          onSave?.(next);
        }}
      />
    );
  if (property.type === "number")
    return (
      <NumberInput
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        value={
          typeof value === "number" || typeof value === "string" ? value : ""
        }
        onChange={onChange}
        onBlur={onBlur}
      />
    );
  if (property.type === "select")
    return (
      <Select
        aria-label={ariaLabel}
        searchable
        clearable
        value={typeof value === "string" ? value : null}
        data={(property.settings as any)?.options ?? []}
        onChange={(next) => {
          onChange(next);
          onSave?.(next);
        }}
        onBlur={onBlur}
      />
    );
  if (property.type === "checkbox")
    return (
      <Switch
        aria-label={ariaLabel}
        checked={Boolean(value)}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    );
  return (
    <TextInput
      aria-label={ariaLabel}
      type={
        property.type === "email"
          ? "email"
          : property.type === "url"
            ? "url"
            : property.type === "phone"
              ? "tel"
              : "text"
      }
      autoFocus={autoFocus}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
    />
  );
}

function localTimestamp(value: string | undefined, timeZone: string): string {
  if (!value) return "";
  if (!value.includes("T")) return `${value}T00:00`;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 16);
  try {
    return formatDatabaseLocalTime(value, timeZone);
  } catch {
    return value.slice(0, 16);
  }
}

function DatabaseDateEditor({
  value,
  onChange,
  onSave,
  label,
  autoFocus,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  onSave?: (value: unknown) => void;
  label: string;
  autoFocus: boolean;
}) {
  const { t } = useTranslation();
  const date = (
    value && typeof value === "object"
      ? value
      : { start: typeof value === "string" ? value : "" }
  ) as DatabaseDateValue;
  const [timed, setTimed] = useState(Boolean(date.start?.includes("T")));
  const [range, setRange] = useState(Boolean(date.end));
  const zone =
    date.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const calendarPart = (part: string) =>
    timed ? localTimestamp(part, zone).slice(0, 10) : part.slice(0, 10);
  const toggleTime = (part: string, nextTimed: boolean) => {
    const calendar = calendarPart(part);
    if (!nextTimed) return calendar;
    const local = `${calendar}T00:00`;
    try {
      return parseDatabaseLocalTime(local, zone);
    } catch {
      return local;
    }
  };
  const change = (field: "start" | "end", text: string) => {
    const next = { ...date, ...(timed ? { timeZone: zone } : {}) };
    if (text) {
      try {
        next[field] = timed ? parseDatabaseLocalTime(text, zone) : text;
      } catch {
        next[field] = text;
      }
    } else if (field === "end") delete next.end;
    else next.start = "";
    onChange(next.start ? next : null);
  };
  return (
    <Stack gap="xs" miw={220}>
      <TextInput
        aria-label={`${label}: ${t("dbTable.start")}`}
        type={timed ? "datetime-local" : "date"}
        value={
          timed
            ? localTimestamp(date.start, zone)
            : (date.start?.slice(0, 10) ?? "")
        }
        onChange={(event) => change("start", event.currentTarget.value)}
        autoFocus={autoFocus}
      />
      {range && (
        <TextInput
          aria-label={`${label}: ${t("dbTable.end")}`}
          type={timed ? "datetime-local" : "date"}
          value={
            timed
              ? localTimestamp(date.end, zone)
              : (date.end?.slice(0, 10) ?? "")
          }
          onChange={(event) => change("end", event.currentTarget.value)}
        />
      )}
      <Group gap="sm">
        <Switch
          label={t("dbTable.includeTime")}
          checked={timed}
          onChange={(event) => {
            const nextTimed = event.currentTarget.checked;
            setTimed(nextTimed);
            onChange(
              date.start
                ? {
                    start: toggleTime(date.start, nextTimed),
                    ...(date.end
                      ? { end: toggleTime(date.end, nextTimed) }
                      : {}),
                    ...(nextTimed ? { timeZone: zone } : {}),
                  }
                : null,
            );
          }}
        />
        <Switch
          label={t("dbTable.dateRange")}
          checked={range}
          onChange={(event) => {
            setRange(event.currentTarget.checked);
            if (!event.currentTarget.checked)
              onChange({
                start: date.start,
                ...(timed ? { timeZone: date.timeZone ?? zone } : {}),
              });
          }}
        />
      </Group>
      {timed && (
        <TextInput
          label={t("dbTable.timeZone")}
          value={date.timeZone ?? zone}
          onChange={(event) =>
            onChange({ ...date, timeZone: event.currentTarget.value })
          }
        />
      )}
      {onSave && (
        <Group>
          <Button size="xs" onClick={() => onSave(value)}>
            {t("Save")}
          </Button>
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              onChange(null);
              onSave(null);
            }}
          >
            {t("Clear")}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
