import assert from 'node:assert/strict';

export function parseQualityQuestionIds(value, split, limit) {
  if (!value) return [];
  assert.equal(
    split,
    'tuning',
    'Explicit quality IDs are tuning-only diagnostics',
  );
  assert.equal(limit, 0, 'Do not combine quality IDs with a quality limit');
  const ids = value.split(',').map((id) => id.trim());
  assert(
    ids.length <= 120 &&
      ids.every((id) => id.length > 0 && id.length <= 100) &&
      new Set(ids).size === ids.length,
    'Invalid or duplicate quality IDs',
  );
  return ids;
}

export function selectQualityQuestions(questions, config) {
  let selected = questions.filter(
    (question) => question.split === config.split,
  );
  if (config.questionIds?.length) {
    assert.equal(
      config.split,
      'tuning',
      'Explicit quality IDs are tuning-only diagnostics',
    );
    const ids = new Set(config.questionIds);
    selected = selected.filter((question) => ids.has(question.id));
    assert.equal(
      selected.length,
      ids.size,
      'Quality IDs must belong to the selected scope and tuning split',
    );
  }
  if (config.limit) selected = selected.slice(0, config.limit);
  assert(selected.length > 0, 'Quality selection must not be empty');
  return selected;
}
