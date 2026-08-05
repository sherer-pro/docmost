import { postgres } from './postgres-client';

describe('postgres runtime import', () => {
  it('normalizes the CommonJS and ESM package entrypoints to a callable client', () => {
    expect(typeof postgres).toBe('function');
  });
});
