import { NotFoundException } from '@nestjs/common';
import { LabelType } from '@docmost/db/repos/label/label.repo';
import { LabelService } from './label.service';

describe('LabelService', () => {
  const trx = { id: 'trx' };

  function createService() {
    const labelRepo = {
      findOrCreate: jest.fn(),
      addLabelToPage: jest.fn(),
      findById: jest.fn(),
      removeLabelFromPage: jest.fn(),
      getLabelPageCount: jest.fn(),
      deleteLabel: jest.fn(),
      findLabelsByPageId: jest.fn(),
      findLabels: jest.fn(),
      findPagesByLabelId: jest.fn(),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: jest.fn((callback: (trxArg: typeof trx) => unknown) =>
          callback(trx),
        ),
      })),
    };
    const pageAccessService = {
      getEffectiveAccess: jest.fn(),
      getSidebarAccessSnapshot: jest.fn(),
    };

    return {
      service: new LabelService(
        labelRepo as any,
        pageAccessService as any,
        db as any,
      ),
      labelRepo,
      pageAccessService,
    };
  }

  it('creates page labels inside the page space', async () => {
    const { service, labelRepo } = createService();
    const label = {
      id: 'label-1',
      name: 'urgent',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      type: LabelType.PAGE,
    };
    labelRepo.findOrCreate.mockResolvedValue(label);

    const result = await service.addLabelsToPage(
      'page-1',
      [' urgent '],
      'workspace-1',
      'space-1',
    );

    expect(result).toEqual([label]);
    expect(labelRepo.findOrCreate).toHaveBeenCalledWith(
      'urgent',
      'workspace-1',
      'space-1',
      LabelType.PAGE,
      trx,
    );
    expect(labelRepo.addLabelToPage).toHaveBeenCalledWith(
      'page-1',
      'label-1',
      trx,
    );
  });

  it('returns normalized duplicate labels only once', async () => {
    const { service, labelRepo } = createService();
    const label = {
      id: 'label-1',
      name: 'qa-label',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
      type: LabelType.PAGE,
    };
    labelRepo.findOrCreate.mockResolvedValue(label);

    const result = await service.addLabelsToPage(
      'page-1',
      [' QA Label ', 'qa-label'],
      'workspace-1',
      'space-1',
    );

    expect(result).toEqual([label]);
    expect(labelRepo.findOrCreate).toHaveBeenCalledTimes(1);
    expect(labelRepo.addLabelToPage).toHaveBeenCalledTimes(1);
  });

  it('rejects removing a label from a different space', async () => {
    const { service, labelRepo } = createService();
    labelRepo.findById.mockResolvedValue({
      id: 'label-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-2',
    });

    await expect(
      service.removeLabelFromPage(
        'page-1',
        'label-1',
        'workspace-1',
        'space-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(labelRepo.removeLabelFromPage).not.toHaveBeenCalled();
    expect(labelRepo.deleteLabel).not.toHaveBeenCalled();
  });

  it('deletes empty labels within the same space', async () => {
    const { service, labelRepo } = createService();
    labelRepo.findById.mockResolvedValue({
      id: 'label-1',
      workspaceId: 'workspace-1',
      spaceId: 'space-1',
    });
    labelRepo.getLabelPageCount.mockResolvedValue(0);

    await service.removeLabelFromPage(
      'page-1',
      'label-1',
      'workspace-1',
      'space-1',
    );

    expect(labelRepo.removeLabelFromPage).toHaveBeenCalledWith(
      'page-1',
      'label-1',
      'workspace-1',
      'space-1',
      trx,
    );
    expect(labelRepo.deleteLabel).toHaveBeenCalledWith(
      'label-1',
      'workspace-1',
      'space-1',
      trx,
    );
  });

  it('lists labels only from pages readable by the current user', async () => {
    const { service, labelRepo, pageAccessService } = createService();
    const readablePageIds = new Set(['page-1']);
    const user = {
      id: 'user-1',
      workspaceId: 'workspace-1',
    } as any;
    const pagination = { limit: 20 } as any;
    const result = { items: [], meta: { limit: 20 } };
    pageAccessService.getSidebarAccessSnapshot.mockResolvedValue({
      readablePageIds,
    });
    labelRepo.findLabels.mockResolvedValue(result);

    await expect(
      service.getLabels(
        'workspace-1',
        user,
        'space-1',
        LabelType.PAGE,
        pagination,
      ),
    ).resolves.toBe(result);

    expect(pageAccessService.getSidebarAccessSnapshot).toHaveBeenCalledWith(
      user,
      'space-1',
    );
    expect(labelRepo.findLabels).toHaveBeenCalledWith(
      'workspace-1',
      'space-1',
      LabelType.PAGE,
      readablePageIds,
      pagination,
    );
  });

  it('applies readable page ids before paginating label page results', async () => {
    const { service, labelRepo, pageAccessService } = createService();
    const readablePageIds = new Set(['page-2']);
    const user = {
      id: 'user-1',
      workspaceId: 'workspace-1',
    } as any;
    const pagination = { limit: 20 } as any;
    const result = { items: [{ id: 'page-2' }], meta: { limit: 20 } };
    pageAccessService.getSidebarAccessSnapshot.mockResolvedValue({
      readablePageIds,
    });
    labelRepo.findPagesByLabelId.mockResolvedValue(result);

    await expect(
      service.findPagesByLabel('label-1', user, {
        spaceId: 'space-1',
        pagination,
      }),
    ).resolves.toBe(result);

    expect(labelRepo.findPagesByLabelId).toHaveBeenCalledWith(
      'label-1',
      'user-1',
      {
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        pagination,
        readablePageIds,
      },
    );
    expect(pageAccessService.getEffectiveAccess).not.toHaveBeenCalled();
  });
});
