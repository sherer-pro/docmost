import { createInstance } from "i18next";
import { describe, expect, it } from "vitest";
import de from "../../../../../public/locales/de-DE/translation.json";
import en from "../../../../../public/locales/en-US/translation.json";
import es from "../../../../../public/locales/es-ES/translation.json";
import fr from "../../../../../public/locales/fr-FR/translation.json";
import itTranslation from "../../../../../public/locales/it-IT/translation.json";
import ja from "../../../../../public/locales/ja-JP/translation.json";
import ko from "../../../../../public/locales/ko-KR/translation.json";
import nl from "../../../../../public/locales/nl-NL/translation.json";
import pt from "../../../../../public/locales/pt-BR/translation.json";
import ru from "../../../../../public/locales/ru-RU/translation.json";
import uk from "../../../../../public/locales/uk-UA/translation.json";
import zh from "../../../../../public/locales/zh-CN/translation.json";

const translations = [
  de,
  en,
  es,
  fr,
  itTranslation,
  ja,
  ko,
  nl,
  pt,
  ru,
  uk,
  zh,
];
const requiredKeys = [
  "Reading time",
  "Reading time info",
  "Estimates reading time from the document text and shows it below the title.",
  "Estimated reading time",
  "readingTime.lessThanMinute",
  "readingTime.overThirtyMinutes",
  "readingTime.minutes_one",
  "readingTime.minutes_few",
  "readingTime.minutes_many",
  "readingTime.minutes_other",
] as const;

describe("reading time translations", () => {
  it("defines every reading-time key in every locale", () => {
    for (const translation of translations) {
      for (const key of requiredKeys) {
        expect(translation).toHaveProperty(key);
      }
    }
  });

  it("uses the required Russian plural forms", async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: "ru-RU",
      resources: { "ru-RU": { translation: ru } },
    });

    expect(i18n.t("readingTime.minutes", { count: 5 })).toBe("5 минут");
    expect(i18n.t("readingTime.minutes", { count: 21 })).toBe("21 минута");
    expect(i18n.t("readingTime.lessThanMinute")).toBe("< 1 минуты");
    expect(i18n.t("readingTime.overThirtyMinutes")).toBe("> 30 минут");
  });
});
