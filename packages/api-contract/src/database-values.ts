import type { DatabaseDateValue, DatabasePropertySettings } from "./database";
import type { DatabasePropertyType } from "./database-property-type";
import {
  isDatabaseComputedProperty,
  parseDatabaseFormula,
} from "./database-formula";

const databaseReferenceId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function databaseUserIds(input: unknown): string[] {
  let value = unwrapDatabaseValue(input);
  for (let i = 0; i < 6 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [
    ...new Set(
      values
        .map((item) => (typeof item === "string" ? item : item?.id))
        .filter(
          (id): id is string =>
            typeof id === "string" && databaseReferenceId.test(id),
        )
        .map((id) => id.toLowerCase()),
    ),
  ];
}

export function databaseFileIds(input: unknown): string[] {
  const ids = new Set<string>();
  const pending = [input];
  let visited = 0;
  while (pending.length) {
    if (++visited > 2048) throw new Error("File references are too complex");
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (
      "attachmentId" in value &&
      typeof value.attachmentId === "string" &&
      databaseReferenceId.test(value.attachmentId)
    )
      ids.add(value.attachmentId.toLowerCase());
    pending.push(...Object.values(value));
  }
  return [...ids];
}

export function remapDatabaseAttachmentReferences(
  input: unknown,
  ids: ReadonlyMap<string, string>,
  omitMissing = false,
): unknown {
  let visited = 0;
  const remap = (value: unknown): unknown => {
    if (++visited > 2048) throw new Error("File references are too complex");
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value))
      return value.map(remap).filter((item) => item !== undefined);
    if ("attachmentId" in value && typeof value.attachmentId === "string") {
      const id = ids.get(value.attachmentId.toLowerCase());
      if (!id) {
        if (omitMissing) return undefined;
        throw new Error("File reference has no attachment mapping");
      }
      return { attachmentId: id };
    }
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, child]) => [key, remap(child)])
        .filter(([, child]) => child !== undefined),
    );
  };
  return remap(input) ?? null;
}

export function unwrapDatabaseValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "rawValueBeforeTypeChange" in value &&
    "value" in value
  )
    return value.value;
  return value;
}

const calendarDate = /^\d{4}-\d{2}-\d{2}$/;
const timestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function validDate(value: string): boolean {
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    return false;
  if (calendarDate.test(value)) return true;
  return timestamp.test(value) && Number.isFinite(Date.parse(value));
}

export function normalizeDatabaseValue(
  type: DatabasePropertyType,
  input: unknown,
  settings?: DatabasePropertySettings | null,
): unknown {
  if (isDatabaseComputedProperty(type))
    throw new Error("Computed properties are read-only");
  const value = unwrapDatabaseValue(input);
  if (value === null || value === undefined || value === "") return null;
  if (type === "number") {
    if (
      typeof value === "string" &&
      !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    )
      throw new Error("Invalid number");
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value.replace(",", "."))
          : NaN;
    if (!Number.isFinite(number)) throw new Error("Invalid number");
    return number;
  }
  if (type === "date") {
    const date =
      typeof value === "string"
        ? { start: value }
        : (value as DatabaseDateValue);
    if (!date || typeof date.start !== "string" || !validDate(date.start))
      throw new Error("Invalid date");
    if (
      date.end !== undefined &&
      (typeof date.end !== "string" ||
        !validDate(date.end) ||
        calendarDate.test(date.start) !== calendarDate.test(date.end) ||
        Date.parse(date.end) < Date.parse(date.start))
    )
      throw new Error("Invalid date range");
    const timed = !calendarDate.test(date.start);
    if (timed && (!date.timeZone || typeof date.timeZone !== "string"))
      throw new Error("A time zone is required");
    if (date.timeZone) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: date.timeZone });
      } catch {
        throw new Error("Invalid time zone");
      }
    }
    return {
      start: timed ? new Date(date.start).toISOString() : date.start,
      ...(date.end
        ? { end: timed ? new Date(date.end).toISOString() : date.end }
        : {}),
      ...(timed ? { timeZone: date.timeZone } : {}),
    };
  }
  if (type === "checkbox") {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      if (
        ["true", "1", "yes", "on", "\u0434\u0430"].includes(
          value.trim().toLowerCase(),
        )
      )
        return true;
      if (
        ["false", "0", "no", "off", "\u043d\u0435\u0442"].includes(
          value.trim().toLowerCase(),
        )
      )
        return false;
    }
    throw new Error("Invalid checkbox");
  }
  if (type === "user" && Array.isArray(value)) {
    if (value.length > 20)
      throw new Error("At most 20 participants are supported");
    const users = value.map(
      (item) => normalizeDatabaseValue("user", item) as { id: string },
    );
    if (users.some((item) => !item)) throw new Error("Invalid participant");
    return [...new Map(users.map((item) => [item.id, item])).values()].sort(
      (a, b) => a.id.localeCompare(b.id),
    );
  }
  if (type === "file") {
    if (!Array.isArray(value) || value.length > 20)
      throw new Error("Invalid file list");
    const ids = new Set<string>();
    return value.map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        Object.keys(item).length !== 1 ||
        typeof item.attachmentId !== "string" ||
        !databaseReferenceId.test(item.attachmentId) ||
        ids.has(item.attachmentId.toLowerCase())
      )
        throw new Error("Invalid file reference");
      ids.add(item.attachmentId.toLowerCase());
      return { attachmentId: item.attachmentId.toLowerCase() };
    });
  }
  if (type === "user" || type === "page_reference") {
    const id =
      typeof value === "string"
        ? value
        : value && typeof value === "object" && "id" in value
          ? value.id
          : null;
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new Error("Invalid reference");
    return type === "user" ? { id: id.toLowerCase() } : id.toLowerCase();
  }
  if (type === "select" || type === "multi_select") {
    const values =
      type === "select"
        ? [
            typeof value === "string"
              ? value
              : (value as { value?: unknown })?.value,
          ]
        : value;
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string"))
      throw new Error("Invalid selection");
    const options = settings && "options" in settings ? settings.options : [];
    if (values.some((v) => !options.some((option) => option.value === v)))
      throw new Error("Unknown selection option");
    return type === "select" ? values[0] : [...new Set(values)].sort();
  }
  if (typeof value !== "string") throw new Error("Invalid text value");
  if (type === "url") {
    try {
      if (!["https:", "http:"].includes(new URL(value).protocol))
        throw new Error();
    } catch {
      throw new Error("Invalid URL");
    }
  }
  if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
    throw new Error("Invalid email");
  if (type === "phone" && (!/^[+\d\s().-]+$/.test(value) || !/\d/.test(value)))
    throw new Error("Invalid phone");
  return value;
}

export function formatDatabaseValue(
  type: string,
  input: unknown,
  settings?: unknown,
  locale?: string,
): string {
  const value = unwrapDatabaseValue(input);
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "error" in value)
    return `#${String(value.error)}`;
  if (type === "user" || type === "updated_by") {
    const users = Array.isArray(value) ? value : [value];
    return users
      .map((user) =>
        typeof user === "string" ? user : (user?.name ?? user?.id ?? ""),
      )
      .filter(Boolean)
      .join(", ");
  }
  if (type === "file")
    return Array.isArray(value)
      ? value
          .map((file) => file?.name ?? file?.attachmentId ?? "")
          .filter(Boolean)
          .join(", ")
      : "";
  if (type === "formula") {
    const resultType = (settings as { resultType?: string })?.resultType;
    return formatDatabaseValue(
      resultType === "text"
        ? "multiline_text"
        : (resultType ?? "multiline_text"),
      value,
      undefined,
      locale,
    );
  }
  const options =
    settings &&
    typeof settings === "object" &&
    "options" in settings &&
    Array.isArray(settings.options)
      ? settings.options
      : [];
  if (type === "multi_select")
    return Array.isArray(value)
      ? value
          .map(
            (id) => options.find((option) => option.value === id)?.label ?? id,
          )
          .join(", ")
      : "";
  if (type === "select") {
    const id =
      typeof value === "object"
        ? ((value as { value?: unknown; id?: unknown }).value ??
          (value as { id?: unknown }).id)
        : value;
    return String(
      options.find((option) => option.value === id)?.label ?? id ?? "",
    );
  }
  if (type === "number") {
    if (typeof value !== "number") return "";
    const numberSettings = settings as {
      format?: string;
      currency?: string;
      precision?: number;
    } | null;
    return new Intl.NumberFormat(locale, {
      style:
        numberSettings?.format === "currency"
          ? "currency"
          : numberSettings?.format === "percent"
            ? "percent"
            : "decimal",
      ...(numberSettings?.format === "currency"
        ? { currency: numberSettings.currency ?? "USD" }
        : {}),
      ...(numberSettings?.precision !== undefined
        ? {
            minimumFractionDigits: numberSettings.precision,
            maximumFractionDigits: numberSettings.precision,
          }
        : {}),
    }).format(value);
  }
  if (
    ["date", "created_at", "updated_at"].includes(type) &&
    typeof value === "object" &&
    "start" in value &&
    typeof value.start === "string"
  ) {
    const date = value as DatabaseDateValue;
    const format = (part: string) => {
      const time = new Date(part.includes("T") ? part : `${part}T00:00:00Z`);
      if (!Number.isFinite(time.getTime())) return part;
      return new Intl.DateTimeFormat(
        locale,
        part.includes("T")
          ? { dateStyle: "medium", timeStyle: "short", timeZone: date.timeZone }
          : { dateStyle: "medium", timeZone: "UTC" },
      ).format(time);
    };
    return [date.start, date.end]
      .filter((part): part is string => Boolean(part))
      .map(format)
      .join(" - ");
  }
  return typeof value === "string" ? value : String(value);
}

export function validateDatabaseSettings(
  type: DatabasePropertyType,
  input: unknown,
): void {
  if (type === "formula") {
    const settings = input as Record<string, unknown>;
    if (
      !settings ||
      settings.languageVersion !== 1 ||
      !["number", "text", "date", "checkbox"].includes(
        String(settings.resultType),
      ) ||
      Object.keys(settings).some(
        (key) => !["expression", "resultType", "languageVersion"].includes(key),
      )
    )
      throw new Error("Invalid formula settings");
    parseDatabaseFormula(settings.expression as string);
    return;
  }
  if (input === null || input === undefined) return;
  if (typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid property settings");
  const settings = input as Record<string, unknown>;
  if (type === "select" || type === "multi_select") {
    if (!Array.isArray(settings.options) || settings.options.length > 100)
      throw new Error("Invalid options");
    const ids = new Set<string>();
    for (const option of settings.options) {
      if (
        !option ||
        typeof option.value !== "string" ||
        !option.value.trim() ||
        typeof option.label !== "string" ||
        !option.label.trim() ||
        option.value.length > 255 ||
        option.label.length > 255 ||
        ids.has(option.value) ||
        (option.color !== undefined &&
          (typeof option.color !== "string" || option.color.length > 32))
      )
        throw new Error("Invalid option");
      ids.add(option.value);
    }
  } else if (type === "number") {
    if (!["number", "percent", "currency"].includes(String(settings.format)))
      throw new Error("Invalid number format");
    if (
      settings.precision !== undefined &&
      (!Number.isInteger(settings.precision) ||
        Number(settings.precision) < 0 ||
        Number(settings.precision) > 10)
    )
      throw new Error("Invalid precision");
    if (
      settings.format === "currency" &&
      (typeof settings.currency !== "string" ||
        !/^[A-Z]{3}$/.test(settings.currency))
    )
      throw new Error("Invalid currency");
  } else if (Object.keys(settings).length)
    throw new Error("Settings are not supported for this property");
}
