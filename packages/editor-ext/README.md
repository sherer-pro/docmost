# Editor Extensions

Shared Tiptap/ProseMirror extensions used by the Docmost client editor and by server-side serialization/rendering paths.

## Contents

- `src/lib/audio` - audio node and upload helpers.
- `src/lib/pdf` - embedded PDF node and upload helpers.
- `src/lib/transclusion` - synced block source/reference nodes and shared constraints.
- `src/lib/attachment`, `src/lib/table`, and related helpers - document node behavior shared with editor rendering.

## Commands

Run from the repository root:

```bash
pnpm editor-ext:build
pnpm test:editor-ext
```

The package builds with `tsc --build` and publishes runtime files from `dist/`; the production Docker image copies both this package manifest and `dist` output for server runtime imports.
