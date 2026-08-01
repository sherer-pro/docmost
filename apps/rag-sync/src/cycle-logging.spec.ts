import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { logCycleFailures } from './cycle-logging.js';

describe('logCycleFailures', () => {
  it('aggregates failures without logging binding identifiers', () => {
    const messages: string[] = [];
    logCycleFailures(
      [
        { status: 'fulfilled', value: true },
        { status: 'rejected', reason: { status: 503 } },
        { status: 'rejected', reason: new Error('binding-1 failed') },
      ],
      (message) => messages.push(message),
    );

    assert.equal(messages.length, 1);
    assert.match(messages[0], /"event":"cycle.failed"/);
    assert.match(messages[0], /"failedBindings":2/);
    assert.doesNotMatch(messages[0], /binding-1|bindingId|spaceId/);
  });
});
