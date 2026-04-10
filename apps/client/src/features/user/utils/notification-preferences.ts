import {
  EmailFrequency,
  NotificationFrequency,
  PushFrequency,
} from "@/features/user/types/user.types.ts";

const NOTIFICATION_FREQUENCIES: NotificationFrequency[] = [
  "immediate",
  "1h",
  "3h",
  "6h",
  "24h",
];

function stripEnclosingQuotes(value: string): string {
  let normalized = value.trim();

  for (let i = 0; i < 5; i += 1) {
    if (
      normalized.length >= 2 &&
      normalized.startsWith("\"") &&
      normalized.endsWith("\"")
    ) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return normalized;
}

export function normalizePreferenceString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = stripEnclosingQuotes(value);
  return normalized.length > 0 ? normalized : null;
}

export function normalizePreferenceBoolean(
  value: unknown,
  fallback: boolean,
): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  const normalizedString = normalizePreferenceString(value)?.toLowerCase();
  if (normalizedString === "true") {
    return true;
  }

  if (normalizedString === "false") {
    return false;
  }

  return fallback;
}

export function normalizePushFrequency(
  value: unknown,
  fallback: PushFrequency,
): PushFrequency {
  const normalized = normalizePreferenceString(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (NOTIFICATION_FREQUENCIES.includes(normalized as NotificationFrequency)) {
    return normalized as PushFrequency;
  }

  return fallback;
}

export function normalizeEmailFrequency(
  value: unknown,
  fallback: EmailFrequency,
): EmailFrequency {
  const normalized = normalizePreferenceString(value)?.toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (NOTIFICATION_FREQUENCIES.includes(normalized as NotificationFrequency)) {
    return normalized as EmailFrequency;
  }

  return fallback;
}
