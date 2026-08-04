jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { ConflictException } from '@nestjs/common';
import {
  deserializeCustomEventError,
  serializeCustomEventError,
} from './redis-sync.extension';

describe('RedisSyncExtension custom event errors', () => {
  it('preserves a structured HTTP 409 across the Redis envelope', () => {
    const serialized = serializeCustomEventError(
      new ConflictException({
        code: 'page_embed_stale',
        message: 'The document changed',
      }),
    );
    const restored = deserializeCustomEventError(serialized);

    expect(restored.getStatus()).toBe(409);
    expect(restored.getResponse()).toEqual({
      code: 'page_embed_stale',
      message: 'The document changed',
    });
  });

  it('does not expose unexpected internal errors', () => {
    expect(serializeCustomEventError(new Error('database secret'))).toEqual({
      status: 500,
      response: { message: 'Collaboration operation failed' },
      message: 'Collaboration operation failed',
    });
  });
});
