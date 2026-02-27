# Contributing

## Language rules for source comments and tests

To keep terminology and maintenance consistent across the monorepo:

- Write all source code comments in English (including inline comments, block comments, JSDoc, and TSDoc).
- Use ASCII-only characters in comments; non-ASCII comments are not allowed.
- Write all test names and test descriptions in English (`describe`, `it`, and similar test-case labels).
- Keep domain terminology consistent in security- and collaboration-related areas (for example: `auth`, `security`, `workspace`, `member`).

These rules apply to changes in `apps/server`, `apps/client`, `packages/editor-ext`, and related tests.

### Quick rule (with examples)

- Comments must be English and ASCII-only.
- ✅ Allowed: `// Validate CSRF token before mutating request state.`
- ❌ Not allowed: `// Проверяем CSRF-токен перед изменением состояния.`

