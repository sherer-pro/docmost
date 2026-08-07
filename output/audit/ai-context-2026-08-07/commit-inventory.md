# Восстановленный набор коммитов AI context/citations

Команды выполнены 2026-08-07 без merge-коммитов. Хеши ниже приведены в порядке `--date-order`.

## Path history

Команда:

```text
git log --all --date-order --no-merges -- \
  apps/client/src/features/ai \
  apps/server/src/core/ai/services/ai-context.service.ts \
  apps/server/src/core/ai/services/ai-citation.service.ts
```

```text
9ea6ef0d  2026-08-07  fix(ai): stabilize assistant profile runtime and cache behavior
532ab4b8  2026-08-07  fix(rag): fence source access and sync cursors
026fbb74  2026-08-07  feat(ai): add weekly usage statistics
cb20905a  2026-08-07  feat(ai): redesign composer profile controls
d12ae528  2026-08-07  fix(ai): format built-in prompts as Markdown lists
7efc545c  2026-08-07  feat(client): add per-space RAG sync settings
2b310723  2026-08-06  fix(client): harden PWA and accessibility
e9caa6ee  2026-08-06  fix(ai): hide technical capability identifiers
89d6418a  2026-08-06  fix(ai): remove admin guide maintenance notice
b9eacba8  2026-08-06  feat(ai): add administrator guide
2f420cbb  2026-08-06  fix(ai): localize built-in tool names
c1fc49da  2026-08-06  feat(ai): reorganize workspace settings tabs
001fc8f0  2026-08-06  test(ai): characterize panel context gating
5359c2a1  2026-08-05  docs(ai): enforce contracts and complete profile localization
ac79826e  2026-08-05  fix(ai): preserve structural Yjs write invariants
7504b996  2026-08-05  feat(ai): add assistant profile management UI
9452e245  2026-08-05  feat(ai): add policy-controlled builtin tools
c1e6f798  2026-08-04  feat(ai): add source citations to responses
3fe75316  2026-08-04  feat(ai): strengthen built-in quick prompts
8f28d9c0  2026-08-04  feat(ai): add secure external MCP tools
3e90886e  2026-08-03  fix(ai): improve descendant selection dialog
702df422  2026-08-03  feat(ai): redesign context manager and composer
2c6c4d08  2026-08-02  fix(ai): distinguish the three agent limit error messages
92ec1e84  2026-08-02  feat(ai): redesign chat composer
b8f2a9fb  2026-08-02  revert: restore AI UX and markdown changes
a5971d56  2026-08-02  revert: remove AI UX and markdown changes
4c33b619  2026-08-01  feat(ai): add markdown chat composer
08ba5fe5  2026-08-01  feat(ai): split assistant rag and mcp settings
1a649382  2026-08-01  feat(core): replace enterprise modules with core capabilities
96c207a6  2026-07-30  feat(ai): improve assistant and MCP experience
1c5f3064  2026-07-30  feat(ai): add integrations hub and MCP onboarding
63dd29ad  2026-07-30  refactor(ai): support sectioned space settings
5d5ea104  2026-07-30  fix(ai): surface pending approval activity
a8a1c892  2026-07-30  fix(ai): preserve drafts during context selection
aa685338  2026-07-30  feat(ai): add bounded agent mode and read-only MCP
ac43631b  2026-07-30  feat(ai): integrate selection actions with editor toolbar
d2ea587d  2026-07-30  fix(ai): guard missing document context
196d1e1d  2026-07-30  feat(ai): expand assistant identity, context, and RAG sync
c71ca5bf  2026-07-29  fix(ai): deduplicate context search results
9ce61c97  2026-07-29  feat(ai): redesign assistant experience
eaa1192d  2026-07-29  feat(ai): display model reasoning in chat
70ddfb53  2026-07-29  feat(ai): add Open WebUI knowledge retrieval
6526ea19  2026-07-29  fix(ai): improve chat context and streaming UX
b2e82258  2026-07-29  feat(ai): redesign space settings
91841794  2026-07-29  feat(ai): add contextual assistant workflows
81dfd697  2026-07-29  feat(ai): add reliable per-space assistant
```

## Message grep history

Команда:

```text
git log --all --grep='context\|citation\|source\|selection\|descendant'
```

```text
532ab4b8  2026-08-07  fix(rag): fence source access and sync cursors
001fc8f0  2026-08-06  test(ai): characterize panel context gating
038ca3a1  2026-08-05  fix(client): stabilize active tree selection
c1e6f798  2026-08-04  feat(ai): add source citations to responses
3e90886e  2026-08-03  fix(ai): improve descendant selection dialog
702df422  2026-08-03  feat(ai): redesign context manager and composer
a8a1c892  2026-07-30  fix(ai): preserve drafts during context selection
ac43631b  2026-07-30  feat(ai): integrate selection actions with editor toolbar
d2ea587d  2026-07-30  fix(ai): guard missing document context
196d1e1d  2026-07-30  feat(ai): expand assistant identity, context, and RAG sync
c71ca5bf  2026-07-29  fix(ai): deduplicate context search results
6526ea19  2026-07-29  fix(ai): improve chat context and streaming UX
91841794  2026-07-29  feat(ai): add contextual assistant workflows
cf71ffd0  2026-06-10  feat(server): add comment location context to markdown copy
82749b28  2026-03-05  fix(client): unify database page context for comments and header
ff54a56c  2026-03-04  fix(server): keep watcher cleanup in transaction context
91607f8f  2026-03-04  fix(database-comments): stabilize page context and description autosave
9ec11f50  2026-03-04  feat(api): migrate space CRUD to resource routes
19fa6926  2026-03-01  fix(database): enforce row parent context and arborist row tree move sync
327e3e68  2026-02-27  fix(editor): normalize linked quote id before parsing source page
a2b16370  2026-02-23  feat(editor): add linked cross-document quotes by source id
e2107d7e  2026-02-22  fix(custom-fields): improve layout, edit mode behavior, and member selection
1d3e5242  2026-02-22  chore(comments): standardize source comments to English
8014ba3a  2025-12-01  feat: Text background highlight (#1754)
17ce3bab  2025-04-04  feat: move page between spaces (#988)
85d18b8c  2025-01-30  Set default language on invitation signup (#691)
f3dbf7cc  2025-01-11  feat: add new languages to selection (#626)
670ee641  2025-01-04  Support I18n (#243)
a1b6ac7f  2024-11-27  fix: close space selection popover onClickOutside (#485)
17475bf1  2024-08-24  feat: code block language selection (#198)
4433d517  2024-08-20  Add Source Label to Dockerfile (#157)
```

## Опорные коммиты

```text
c71ca5bf5db830e6baac76eb0037a8c724b15116  2026-07-29  fix(ai): deduplicate context search results
3e90886e68e44da049511fa1a211c03feeed35c0  2026-08-03  fix(ai): improve descendant selection dialog
c1e6f79857fbaca258ff4b41dc31cee0b61d1150  2026-08-04  feat(ai): add source citations to responses
cc5d16b9c941b2a9c8c98d617f6470a021602335  2026-08-02  fix(ai): tolerate a single unreadable Open WebUI file during retrieval
9b67ae10c47a1e7b707452169a823952c0f8db74  2026-08-02  fix(search): sanitize full-text queries before to_tsquery
001fc8f0697b0967590b07d7e460b284343ca873  2026-08-06  test(ai): characterize panel context gating
ac43631b97c23adb16880cb8260f414cffc1eec2  2026-07-30  feat(ai): integrate selection actions with editor toolbar
```

`cc5d16b` и `9b67ae1` не меняют перечисленные в path-команде файлы и не совпадают с grep-pattern по commit message, поэтому в двух дословных выборках выше отсутствуют. Они были восстановлены и изучены отдельно через `git show` как опорные regression fixes.
