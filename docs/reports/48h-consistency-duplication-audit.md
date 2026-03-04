# Repository Audit for the Last 48 Hours: Consistency and Duplication

## 1) Analysis Method

The review was performed across two layers:

1. **Change history over the last 48 hours** (commits + files, edit frequency).
2. **Current code state at `HEAD`** in the most frequently changed areas (routing, cache, action menus, page/database deletion and conversion).

### Commands used for the analysis

```bash
git log --since='48 hours ago' --pretty=format:'%h %ad %an %s' --date=iso
git log --since='48 hours ago' --oneline --decorate --graph --max-count=80
git log --since='48 hours ago' --name-only --pretty=format:'--- %h %ad %s' --date=iso > /tmp/log48.txt
awk '/^apps\//{print}' /tmp/log48.txt | sort | uniq -c | sort -nr | head -n 30
git show --stat --oneline 77b233fa
git show --stat --oneline a49e2511
rg -n "invalidateOnDeletePage|dropTreeNode|handleCopyLink|Convert database to page\?|/s/\$\{spaceSlug\}/p/\$\{result.slugId\}" \
  apps/client/src/features/page/queries/page-query.ts \
  apps/client/src/features/database/components/header/database-header-menu.tsx \
  apps/client/src/features/page/components/header/page-header-menu.tsx
```

## 2) Consistency Status

### Positive trend (consistency is improving)

1. **Cache invalidation centralization** has been introduced in a dedicated module (`invalidateSidebarTree`, `invalidateDatabaseEntity`, `invalidatePageEntity`, `invalidateDatabaseRowContext`). This reduces the risk of desynchronization across page/database flows.
2. **Identifier contract unification** (id/slug/databaseId) has been moved into an adapter, which decreases the number of ad-hoc transformations in the UI.
3. **URL builders for database routes** have been extracted into `buildDatabaseUrl`/`buildDatabaseNodeUrl`, which generally reduces manual link construction.

## 3) Identified Inconsistencies

### 3.1. Different route construction approaches in similar scenarios

- In `database-header-menu`, after `database -> page`, a **manual template** is used: `navigate(`/s/${spaceSlug}/p/${result.slugId}`)`.
- In `page-header-menu`, similar transitions are built through a helper (`buildPageUrl`).

**Risk:** duplicated routing logic in string templates increases the chance of future divergence (especially when URL format changes).

### 3.2. Duplicate wrapper for copy-link

- In `database-header-menu`, there is `handleCopyDatabaseLink`, while `handleCopyLink` only proxies the call without additional logic.

**Risk:** an extra abstraction layer without added value increases noise and complicates maintenance.

### 3.3. Repeated conversion modal text/scenario in two menus

- The `Convert database to page?` confirmation and closely related business logic are present in both page and database menus.

**Risk:** on future updates, text and behavior can easily drift apart (translations, side effects, invalidation policy).

## 4) Duplication and Redundancy in Commit History

### 4.1. Explicitly duplicated commit (identical patch)

Commits:
- `77b233fa feat(client): add page-scoped full width toggle`
- `a49e2511 feat(client): add page-scoped full width toggle`

Both have the same file set and the same change statistics (7 files, +103/-8).

**Conclusion:** a duplicate patch was introduced into history (likely due to parallel PR branches and merge sequencing).

### 4.2. High edit concentration in “hot” files

Top files by edit frequency over 48 hours:
- `database-table-view.tsx` — 22
- `database-page.tsx` — 21
- `space-tree.tsx` — 21
- `page.service.ts` — 18
- `database.service.ts` — 15
- `database-header-menu.tsx` — 15
- `page-query.ts` — 14

**Conclusion:** the page/database/tree architectural area is being actively stabilized, but it remains a high-risk zone for regressions and repeated logic.

## 5) Assessment by API/Modules

1. **API/id/slug contracts:** the overall trend is positive (unification is in progress), but there are still manual route constructions in some UI paths.
2. **Cache and state sync:** after introducing the shared invalidation module, consistency improved, but part of deletion/synchronization operations is still split across the mutation layer and UI layer.
3. **Menu component architecture:** there is progress toward shared action items (`DocumentCommonActionItems`), but conversion/deletion domain actions are still duplicated across two major menus.

## 6) Practical Recommendations

1. **Finalize a single routing adapter**: disallow manual route strings in feature components and keep only helper functions.
2. **Extract conversion flows into a shared hook/service** (for example, `useDocumentTypeConversion`) and reuse it in page/database menus.
3. **Simplify the action handler layer**: remove proxy wrappers without additive logic (`handleCopyLink -> handleCopyDatabaseLink`).
4. **Add a duplicate-patch guard to the review process** (for example, patch-id validation in a PR template/checklist).
5. **Introduce local contract tests for hot files** for routing/invalidation behavior (especially `space-tree`, `page-query`, `database-page`).

## 7) Brief Summary

- Over the last 48 hours, the team has made visible progress in **unifying** page/database scenarios.
- The main risks at this stage are not missing functionality, but **residual UI logic duplication** and **patch repetition in history**.
- If routing and conversion are finalized around a single center and branch-duplication checks are strengthened, consistency will improve significantly.
