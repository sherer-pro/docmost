import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createConvertDatabaseToPageAction } from './document-conversion-actions.shared';

describe('createConvertDatabaseToPageAction', () => {
  it('выполняет mutation и затем показывает уведомление + navigation при наличии slugId', async () => {
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

  it('не выполняет navigation, если conversion не вернула slugId', async () => {
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
