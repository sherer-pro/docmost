import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { buildPageUrl } from './page.utils';

describe('buildPageUrl', () => {
  it('builds a canonical page route inside space', () => {
    const route = buildPageUrl('engineering', 'a1b2c3', 'Project Plan');

    assert.equal(route, '/s/engineering/p/project-plan-a1b2c3');
  });

  it('appends anchor when anchorId is provided', () => {
    const route = buildPageUrl('engineering', 'a1b2c3', 'Project Plan', 'section-2');

    assert.equal(route, '/s/engineering/p/project-plan-a1b2c3#section-2');
  });

  it('supports route without space slug for legacy/global pages', () => {
    const route = buildPageUrl(undefined as unknown as string, 'a1b2c3', 'Project Plan');

    assert.equal(route, '/p/project-plan-a1b2c3');
  });
});

