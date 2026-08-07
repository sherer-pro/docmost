# ED-006 remediation

Status: **resolved in the working tree and verified in Chromium and Firefox**.

## Root cause and fix

`DrawioView.handleSave` previously passed the node's persisted `attachmentId`
to every upload. ProseMirror copy/paste preserves node attributes, so saving a
copy overwrote the source attachment.

The save path now counts references to the attachment in the current document.
When another node shares the ID, the edited diagram omits the update ID and the
server creates a new attachment. A uniquely referenced diagram still updates
in place, avoiding a new file on every ordinary save.

If a copied node carries an attachment from another page, a deleted attachment,
or an incompatible attachment type, the server rejects the update with its
specific attachment-conflict response. The client retries only those exact
conflicts without the old ID, so the copy gets a new attachment while unrelated
upload errors still surface.

## Regression coverage

- Unit coverage verifies unsaved, uniquely referenced, and shared attachment
  decisions, the two supported server conflict responses, and unrelated errors.
- The existing full editing scenario now requires two distinct IDs instead of
  recording `ED-006` as an observation.
- A dedicated browser scenario creates two Draw.io nodes sharing one ID, saves
  the second, and checks that the source ID is unchanged while the copy receives
  a different ID.

Focused Playwright result: **2/2 passed** (`chromium-desktop`,
`firefox-desktop`). The browser check used current Vite source against the
existing backend; `DOCMOST_API_ORIGIN` retained the trusted backend origin for
CSRF validation.

## Files

- `apps/client/src/features/editor/components/drawio/drawio-view.tsx`
- `apps/client/src/features/editor/components/diagram/diagram-attachment.ts`
- `apps/client/src/features/editor/components/diagram/diagram-attachment.test.ts`
- `apps/client/e2e/editor/specs/drawio-copy-on-write.spec.ts`
- editor audit runtime-origin support and documentation
