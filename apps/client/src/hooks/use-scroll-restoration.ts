import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { DEFAULT_REMEMBER_PAGE_SCROLL_POSITION } from "@/features/user/constants/scroll-preferences.ts";
import { useAtomValue } from "jotai";
import { useEffect, useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

const SCROLL_POSITION_STORAGE_KEY_PREFIX = "docmost:scroll-position-by-path";

/**
 * Набор задержек (в миллисекундах) для повторного применения восстановленного скролла.
 *
 * Зачем это нужно:
 * - часть страниц догружается асинхронно уже после первого рендера;
 * - некоторые компоненты/роутер могут поздно влиять на позицию viewport;
 * - повторные попытки в коротком окне времени позволяют «перекрыть»
 *   поздний сброс в 0 и устранить визуальный скачок.
 */
const RESTORE_ATTEMPT_DELAYS_MS = [0, 50, 120, 250, 500, 900, 1400] as const;

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

  /**
   * Управляем нативным поведением браузера отдельно от route-эффекта,
   * чтобы не было «мигания» между `manual` и `auto` при навигации.
   */
  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;

    if (rememberPageScrollPosition) {
      window.history.scrollRestoration = "manual";

      return () => {
        window.history.scrollRestoration = previousScrollRestoration;
      };
    }

    window.history.scrollRestoration = "auto";
    sessionStorage.removeItem(storageKey);

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, [rememberPageScrollPosition, storageKey]);

  useLayoutEffect(() => {
    if (!rememberPageScrollPosition) {
      return;
    }

    // Используем pathname + query + hash, чтобы корректно различать
    // страницы с разными параметрами и якорями.
    const routeKey = `${location.pathname}${location.search}${location.hash}`;
    const savedPositions = readSavedPositions(storageKey);
    const savedPosition = savedPositions[routeKey];

    let cancelRestore: (() => void) | undefined;

    if (typeof savedPosition === "number") {
      cancelRestore = restoreScrollWithDeferredAttempts(savedPosition);
    }

    return () => {
      cancelRestore?.();

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
 * Пытается восстановить скролл не один раз, а серией отложенных попыток.
 *
 * Такой подход уменьшает шанс, что поздняя доотрисовка страницы или
 * внутренняя логика компонентов снова принудительно вернёт viewport к началу.
 *
 * @param targetScrollY Позиция по оси Y, которую нужно восстановить.
 * @returns Функция очистки, отменяющая все запланированные попытки.
 */
function restoreScrollWithDeferredAttempts(targetScrollY: number): () => void {
  const timeoutIds: number[] = [];

  const scrollToTargetPosition = () => {
    window.scrollTo({ top: targetScrollY, left: 0, behavior: "auto" });
  };

  for (const delayMs of RESTORE_ATTEMPT_DELAYS_MS) {
    const timeoutId = window.setTimeout(() => {
      scrollToTargetPosition();
    }, delayMs);

    timeoutIds.push(timeoutId);
  }

  return () => {
    for (const timeoutId of timeoutIds) {
      window.clearTimeout(timeoutId);
    }
  };
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
