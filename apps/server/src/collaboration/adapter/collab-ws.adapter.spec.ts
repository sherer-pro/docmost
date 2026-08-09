import { COLLAB_MAX_PAYLOAD_BYTES } from '../constants';
import { CollabWsAdapter } from './collab-ws.adapter';

describe('CollabWsAdapter', () => {
  it('caps collaboration frames below the ws 100 MiB default', () => {
    const adapter = new CollabWsAdapter();

    expect((adapter as any).wss.options.maxPayload).toBe(
      COLLAB_MAX_PAYLOAD_BYTES,
    );

    adapter.destroy();
  });
});
