export function formatDatabaseLocalTime(
  value: string,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function parseDatabaseLocalTime(
  value: string,
  timeZone: string,
): string {
  const expected = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(expected)) throw new Error("Invalid time");
  let candidate = expected;
  for (let pass = 0; pass < 3; pass += 1) {
    const rendered = formatDatabaseLocalTime(
      new Date(candidate).toISOString(),
      timeZone,
    );
    const offset = Date.parse(`${rendered}:00Z`) - expected;
    if (!offset) return new Date(candidate).toISOString();
    candidate -= offset;
  }
  throw new Error("This local time does not exist in the selected time zone");
}
