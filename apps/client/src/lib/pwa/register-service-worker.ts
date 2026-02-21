/**
 * Регистрирует Service Worker только в production-режиме и только в браузерах,
 * где доступен соответствующий API. Такой guard нужен, чтобы:
 * 1) не мешать DX в dev (HMR + кэш service worker часто конфликтуют);
 * 2) не выполнять лишнюю работу в неподдерживаемых окружениях;
 * 3) централизованно контролировать поведение обновлений PWA.
 */
export async function registerServiceWorker(): Promise<void> {
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });

      /**
       * Если обнаружили новую версию SW, включаем обработчик её установки.
       * Когда новый worker активируется, перезагружаем страницу, чтобы
       * приложение сразу получило свежий bundle/asset-кэш.
       */
      registration.addEventListener("updatefound", () => {
        const nextWorker = registration.installing;

        if (!nextWorker) {
          return;
        }

        nextWorker.addEventListener("statechange", () => {
          if (
            nextWorker.state === "activated" &&
            navigator.serviceWorker.controller
          ) {
            window.location.reload();
          }
        });
      });
    } catch (error) {
      // Ошибку логируем явно: это помогает быстрее диагностировать проблемы
      // с HTTPS, scope, CSP или некорректным response для /sw.js.
      console.error("Не удалось зарегистрировать Service Worker:", error);
    }
  });
}
