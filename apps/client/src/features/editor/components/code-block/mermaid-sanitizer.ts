import DOMPurify from 'dompurify';

/**
 * Sanitizes Mermaid-generated SVG using a strict SVG-only profile.
 *
 * Security policy:
 * - Allow only DOMPurify SVG profile.
 * - Disallow HTML/MathML and any dangerous attributes/protocols that DOMPurify
 *   strips in this mode (e.g. inline handlers and `javascript:` links).
 */
export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: {
      svg: true,
    },
  });
}
