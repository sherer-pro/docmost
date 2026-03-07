import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createConvertDatabaseToPageAction } from './document-conversion-actions.shared';

describe('createConvertDatabaseToPageAction', () => {
  it('runs mutation and then notifies + navigates when slugId exists', async () => {
    const callOrder: string[] = [];

    const onConfirm = createConvertDatabaseToPageAction({
      convertDatabaseToPageAsync: async () => {
        callOrder.push('mutation');
        return { slugId: 'converted-page' };
      },
      onNotifySuccess: () => {
        callOrder.push('notification');
      },
      onNavigateAfterSuccess: () => {
        callOrder.push('navigation');
      },
    });

    await onConfirm();

    assert.deepEqual(callOrder, ['mutation', 'notification', 'navigation']);
  });

  it('does not navigate if conversion result has no slugId', async () => {
    const callOrder: string[] = [];

    const onConfirm = createConvertDatabaseToPageAction({
      convertDatabaseToPageAsync: async () => {
        callOrder.push('mutation');
        return {};
      },
      onNotifySuccess: () => {
        callOrder.push('notification');
      },
      onNavigateAfterSuccess: () => {
        callOrder.push('navigation');
      },
    });

    await onConfirm();

    assert.deepEqual(callOrder, ['mutation', 'notification']);
  });
});

