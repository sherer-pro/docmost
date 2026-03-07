import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  shouldApplyFocusSafeTitleSync,
  shouldNavigateToCanonicalSlug,
} from './title-editor-sync';

describe('title editor sync helpers', () => {
  it('blocks external setContent while user continuously types in focused editor', () => {
    const result = shouldApplyFocusSafeTitleSync({
      entityId: 'db-1',
      lastSyncedEntityId: 'db-1',
      nextTitle: 'New title from autosave',
      currentTitle: 'New title',
      isFocused: true,
      hasCollapsedSelection: true,
    });

    assert.equal(result, false);
  });

  it('allows setContent when switching to a different entity id', () => {
    const result = shouldApplyFocusSafeTitleSync({
      entityId: 'db-2',
      lastSyncedEntityId: 'db-1',
      nextTitle: 'Another database',
      currentTitle: 'New title',
      isFocused: true,
      hasCollapsedSelection: true,
    });

    assert.equal(result, true);
  });

  it('defers canonical slug navigation during active typing and releases it after blur', () => {
    const shouldDeferWhileEditing = shouldNavigateToCanonicalSlug(
      'old-slug',
      'new-slug',
      true,
    );
    const shouldNavigateAfterBlur = shouldNavigateToCanonicalSlug(
      'old-slug',
      'new-slug',
      false,
    );

    assert.equal(shouldDeferWhileEditing, false);
    assert.equal(shouldNavigateAfterBlur, true);
  });
});

