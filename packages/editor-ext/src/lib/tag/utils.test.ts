import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { tagInputRegex, tagPasteRegex } from './tag';
import {
  builtInTagDefinitions,
  builtInTagValues,
  getTagColor,
  getTagLabel,
} from './utils';

describe('built-in tags', () => {
  it('defines six stable values, labels, and colors', () => {
    assert.deepEqual(builtInTagValues, [
      'tbd',
      'todo',
      'done',
      'core',
      'future',
      'pilot',
    ]);
    assert.deepEqual(
      builtInTagDefinitions.map(({ label, color }) => ({ label, color })),
      [
        { label: 'TBD', color: 'red' },
        { label: 'TODO', color: 'blue' },
        { label: 'DONE', color: 'green' },
        { label: 'Core', color: 'violet' },
        { label: 'Future', color: 'cyan' },
        { label: 'Pilot', color: 'orange' },
      ],
    );
  });

  it('preserves the exact display case for every label', () => {
    assert.deepEqual(
      builtInTagValues.map((value) => getTagLabel(value)),
      ['TBD', 'TODO', 'DONE', 'Core', 'Future', 'Pilot'],
    );
    assert.equal(getTagColor('core'), 'violet');
    assert.equal(getTagColor('future'), 'cyan');
    assert.equal(getTagColor('pilot'), 'orange');
  });

  it('matches every built-in label in the tag input rule', () => {
    for (const label of ['TBD', 'TODO', 'DONE', 'Core', 'Future', 'Pilot']) {
      assert.equal(tagInputRegex.test(`::tag[${label}]`), true);
    }
    assert.equal(tagInputRegex.test('::tag[Blocked]'), false);
  });

  it('matches every built-in label inside mixed pasted text', () => {
    const source =
      'Now ::tag[TBD] ::tag[TODO] ::tag[DONE] ::tag[Core] ::tag[Future] ::tag[Pilot].';

    assert.deepEqual(
      Array.from(source.matchAll(tagPasteRegex), (match) => match[1]),
      ['TBD', 'TODO', 'DONE', 'Core', 'Future', 'Pilot'],
    );
  });
});
