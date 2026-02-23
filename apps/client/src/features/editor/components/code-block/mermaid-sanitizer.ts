/**
 * Returns Mermaid SVG without additional sanitization.
 *
 * Why this is implemented this way:
 * - After tightening the sanitizer (DOMPurify `SVG-only` profile), the resulting SVG
 *   had Mermaid HTML labels removed (usually inside `<foreignObject>`), which caused
 *   text to disappear in diagrams.
 * - To restore correct text rendering, we intentionally use passthrough.
 *
 * Security note:
 * - This weakens XSS protection at the client-side SVG sanitizer layer.
 * - A baseline protection layer is still provided by Mermaid via `securityLevel: "strict"`.
 */
export function sanitizeMermaidSvg(svg: string): string {
  return svg;
}
