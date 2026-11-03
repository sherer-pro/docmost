import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n.ts", async () => {
  const { createInstance } = await import("i18next");
  const i18n = createInstance();
  await i18n.init({
    lng: "en-US",
    resources: { "en-US": { translation: {} }, "ru-RU": { translation: {} } },
  });
  return { default: i18n };
});
import i18n from "@/i18n.ts";
import { formattedDate, getDateLocale, timeAgo } from "./time";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-02T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("UI date locales", () => {
  it.each([
    ["de-DE", "de"],
    ["en-US", "en-US"],
    ["es-ES", "es"],
    ["fr-FR", "fr"],
    ["it-IT", "it"],
    ["ja-JP", "ja"],
    ["ko-KR", "ko"],
    ["nl-NL", "nl"],
    ["pt-BR", "pt-BR"],
    ["ru-RU", "ru"],
    ["uk-UA", "uk"],
    ["zh-CN", "zh-CN"],
  ])("maps supported UI locale %s deliberately", (language, code) => {
    expect(getDateLocale(language).code).toBe(code);
    expect(getDateLocale(language.split("-")[0]).code).toBe(code);
  });

  it("matches language variants and falls back to English", () => {
    expect(getDateLocale("RU_ru").code).toBe("ru");
    expect(getDateLocale("pt-PT").code).toBe("pt-BR");
    expect(getDateLocale("zh-TW").code).toBe("zh-CN");
    expect(getDateLocale("unsupported").code).toBe("en-US");
    expect(getDateLocale("constructor").code).toBe("en-US");
  });

  it("formats past and future relative time after a language change without changing timestamps", async () => {
    const past = new Date("2026-10-31T15:00:00+03:00");
    const future = new Date("2026-11-02T18:00:00+03:00");
    const original = [past.getTime(), future.getTime()];
    await i18n.changeLanguage("en-US");
    expect(timeAgo(past)).toBe("2 days ago");
    expect(timeAgo(future)).toBe("in 3 hours");
    await i18n.changeLanguage("ru-RU");
    expect(timeAgo(past)).toBe("2 дня назад");
    expect(timeAgo(future)).toBe("через 3 часа");
    expect([past.getTime(), future.getTime()]).toEqual(original);
    expect(timeAgo(new Date(past.toISOString()), "ru-RU")).toBe(timeAgo(past));
  });

  it("localizes calendar names while keeping the existing local clock tokens", async () => {
    const date = new Date(2026, 9, 25, 13, 42);
    await i18n.changeLanguage("en-US");
    expect(formattedDate(date)).toBe("Oct 25, 2026, 1:42PM");
    await i18n.changeLanguage("ru-RU");
    expect(formattedDate(date)).toContain("25, 2026, 1:42");
    expect(formattedDate(date)).not.toContain("Oct");
    expect(date.getHours()).toBe(13);
  });
});
