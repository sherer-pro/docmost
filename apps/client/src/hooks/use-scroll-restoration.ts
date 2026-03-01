import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { DEFAULT_REMEMBER_PAGE_SCROLL_POSITION } from "@/features/user/constants/scroll-preferences.ts";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const SCROLL_POSITION_STORAGE_KEY_PREFIX = "docmost:scroll-position-by-path";

/**
 * Восстанавливает прокрутку по каждому маршруту, если пользователь включил
 * соответствующую настройку в разделе /settings/account/preferences.
 *
 * Как это работает:
 * 1) При уходе со страницы сохраняем её scrollY в sessionStorage.
 * 2) При входе на страницу читаем сохранённое значение и скроллим к нему.
 * 3) При выключенной настройке очищаем накопленные позиции и выходим.
 */
export function useScrollRestoration() {
  const user = useAtomValue(userAtom);
  const location = useLocation();
  const rememberPageScrollPosition =
    user?.settings?.preferences?.rememberPageScrollPosition ??
    DEFAULT_REMEMBER_PAGE_SCROLL_POSITION;
  const storageKey = `${SCROLL_POSITION_STORAGE_KEY_PREFIX}:${user?.id ?? "anonymous"}`;

  useEffect(() => {
    if (!rememberPageScrollPosition) {
      sessionStorage.removeItem(storageKey);
      return;
    }

    // Используем pathname + query + hash, чтобы корректно различать
    // страницы с разными параметрами и якорями.
    const routeKey = `${location.pathname}${location.search}${location.hash}`;
    const savedPositions = readSavedPositions(storageKey);
    const savedPosition = savedPositions[routeKey];

    if (typeof savedPosition === "number") {
      window.scrollTo({ top: savedPosition, left: 0, behavior: "auto" });
    }

    return () => {
      const updatedPositions = {
        ...savedPositions,
        [routeKey]: window.scrollY,
      };

      sessionStorage.setItem(
        storageKey,
        JSON.stringify(updatedPositions),
      );
    };
  }, [location.hash, location.pathname, location.search, rememberPageScrollPosition, storageKey]);
}

/**
 * Безопасно читает словарь сохранённых scroll-позиций из sessionStorage.
 *
 * Если данные повреждены или отсутствуют, возвращает пустой объект,
 * чтобы не ломать навигацию и не генерировать runtime-ошибки.
 */
function readSavedPositions(storageKey: string): Record<string, number> {
  const rawValue = sessionStorage.getItem(storageKey);

  if (!rawValue) {
    return {};
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Record<string, unknown>;
    const positions: Record<string, number> = {};

    for (const [key, value] of Object.entries(parsedValue)) {
      if (typeof value === "number") {
        positions[key] = value;
      }
    }

    return positions;
  } catch {
    return {};
  }
}
