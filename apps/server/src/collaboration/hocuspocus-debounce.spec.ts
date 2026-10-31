import { Hocuspocus, useDebounce } from '@hocuspocus/server';

describe('Hocuspocus rejected persistence recovery', () => {
  it('releases a rejected execution before the next operation on the same document', async () => {
    const queue = useDebounce();
    await expect(queue.debounce('document', async () => {
      throw new Error('synthetic storage rejection');
    }, 0, 0)).rejects.toThrow('synthetic storage rejection');
    expect(queue.isCurrentlyExecuting('document')).toBe(false);
    const recovery = jest.fn(async () => 'recovered');
    await expect(queue.debounce('document', recovery, 0, 0)).resolves.toBe('recovered');
    expect(recovery).toHaveBeenCalledTimes(1);
  });

  it('allows an actual direct connection to save again after its storage hook rejects', async () => {
    let reject = true;
    const server = new Hocuspocus({ quiet: true, unloadImmediately: false,
      onStoreDocument: async () => {
        if (reject) throw new Error('synthetic storage rejection');
      },
    });
    const connection = await server.openDirectConnection('page.storage-recovery', {});
    try {
      await expect(connection.transact(() => undefined)).rejects.toThrow('synthetic storage rejection');
      reject = false;
      await expect(connection.transact(() => undefined)).resolves.toBeUndefined();
    } finally {
      reject = false;
      await connection.disconnect();
      for (const document of server.documents.values()) document.destroy();
      server.documents.clear();
    }
  });
});
