import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingDocmostImport,
  loadPendingDocmostImport,
  storePendingDocmostImport,
} from './pending-docmost-import';

describe('pending Docmost import storage', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('isolates task IDs by target space and clears terminal tasks', () => {
    storePendingDocmostImport('space-a', 'task-a');
    storePendingDocmostImport('space-b', 'task-b');

    expect(loadPendingDocmostImport('space-a')).toBe('task-a');
    expect(loadPendingDocmostImport('space-b')).toBe('task-b');

    clearPendingDocmostImport('space-a');
    expect(loadPendingDocmostImport('space-a')).toBeNull();
    expect(loadPendingDocmostImport('space-b')).toBe('task-b');
  });

  it('fails safely when browser storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      removeItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    });

    expect(loadPendingDocmostImport('space-a')).toBeNull();
    expect(() => storePendingDocmostImport('space-a', 'task-a')).not.toThrow();
    expect(() => clearPendingDocmostImport('space-a')).not.toThrow();
  });
});
