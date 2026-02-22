import DOMPurify from 'dompurify';

/**
 * Очищает SVG-строку, полученную от Mermaid, с максимально узким профилем для SVG.
 *
 * Политика безопасности:
 * - Разрешаем только SVG-профиль DOMPurify.
 * - Запрещаем HTML/MathML и любые опасные атрибуты/протоколы, которые DOMPurify
 *   автоматически вычищает в этом режиме (например, inline-обработчики и javascript:-ссылки).
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: {
      svg: true,
    },
  });
}
