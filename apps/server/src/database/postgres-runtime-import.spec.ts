import * as postgres from 'postgres';

describe('postgres runtime import', () => {
  it('is callable from the CommonJS output used by production entrypoints', () => {
    expect(typeof postgres).toBe('function');
  });
});
