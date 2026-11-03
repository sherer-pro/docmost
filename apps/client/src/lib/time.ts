import { formatDistanceStrict } from "date-fns";
import { format, isToday, isYesterday } from "date-fns";
import i18n from "@/i18n.ts";
import {
  de,
  enUS,
  es,
  fr,
  it,
  ja,
  ko,
  nl,
  ptBR,
  ru,
  uk,
  zhCN,
} from "date-fns/locale";
import type { Locale } from "date-fns";

const dateLocales: Record<string, Locale> = {
  de,
  en: enUS,
  es,
  fr,
  it,
  ja,
  ko,
  nl,
  pt: ptBR,
  ru,
  uk,
  zh: zhCN,
};

export function getDateLocale(language = i18n.language): Locale {
  const base = (language || "en-US").toLowerCase().split(/[-_]/)[0];
  return Object.prototype.hasOwnProperty.call(dateLocales, base)
    ? dateLocales[base]
    : enUS;
}

export function timeAgo(date: Date, language = i18n.language) {
  return formatDistanceStrict(new Date(date), new Date(), {
    addSuffix: true,
    locale: getDateLocale(language),
  });
}

export function formattedDate(date: Date) {
  const options = { locale: getDateLocale() };
  if (isToday(date)) {
    return i18n.t("Today, {{time}}", { time: format(date, "h:mma", options) });
  } else if (isYesterday(date)) {
    return i18n.t("Yesterday, {{time}}", {
      time: format(date, "h:mma", options),
    });
  } else {
    return format(date, "MMM dd, yyyy, h:mma", options);
  }
}
