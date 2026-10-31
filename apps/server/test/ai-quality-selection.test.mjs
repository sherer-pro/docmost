import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseQualityQuestionIds,
  selectQualityQuestions,
} from './ai-quality-selection.mjs';

const questions = [
  { id: 'first', split: 'tuning' },
  { id: 'second', split: 'tuning' },
  { id: 'held', split: 'holdout' },
];

test('full quality selection is unchanged without explicit tuning IDs', () => {
  assert.deepEqual(
    selectQualityQuestions(questions, { split: 'tuning' }),
    questions.slice(0, 2),
  );
  assert.deepEqual(
    selectQualityQuestions(questions, { split: 'holdout' }),
    questions.slice(2),
  );
});

test('targeted tuning preserves corpus order and rejects missing or held IDs', () => {
  const questionIds = parseQualityQuestionIds('second, first', 'tuning', 0);
  assert.deepEqual(
    selectQualityQuestions(questions, { split: 'tuning', questionIds }),
    questions.slice(0, 2),
  );
  for (const id of ['held', 'unknown'])
    assert.throws(
      () =>
        selectQualityQuestions(questions, {
          split: 'tuning',
          questionIds: [id],
        }),
      /selected scope and tuning split/,
    );
  assert.throws(
    () =>
      selectQualityQuestions(questions, {
        split: 'holdout',
        questionIds: ['held'],
      }),
    /tuning-only/,
  );
});

test('explicit diagnostics cannot select holdout or combine selection controls', () => {
  assert.throws(
    () => parseQualityQuestionIds('held', 'holdout', 0),
    /tuning-only/,
  );
  assert.throws(() => parseQualityQuestionIds('first', 'tuning', 1), /combine/);
  for (const value of ['first,first', 'first,', 'x'.repeat(101)])
    assert.throws(
      () => parseQualityQuestionIds(value, 'tuning', 0),
      /Invalid or duplicate/,
    );
});
