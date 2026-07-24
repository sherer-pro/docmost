/**
 * Deprecated module path. Space custom links are now managed directly in the
 * space sidebar; the add form lives in custom-link-form-modal.tsx.
 *
 * This file only re-exports the form modal for backward compatibility and can
 * be removed once no external references remain.
 */
export { default } from "./custom-link-form-modal.tsx";
export type { CustomLinkFormValue } from "./custom-link-form-modal.tsx";
