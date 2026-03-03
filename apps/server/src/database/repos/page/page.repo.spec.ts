import { PageRepo } from './page.repo';
import { EventName } from '../../../common/events/event.contants';
import * as dbUtils from '../../utils';

describe('PageRepo identifier contract', () => {
  const updateTableMock = jest.fn();
  const setMock = jest.fn();
  const whereMock = jest.fn();
  const executeTakeFirstMock = jest.fn();

  const deleteWhereMock = jest.fn();
  const deleteExecuteMock = jest.fn();

  const dbMock = {
    updateTable: updateTableMock,
    deleteFrom: jest.fn(() => ({ where: deleteWhereMock })),
    withRecursive: jest.fn(),
    selectFrom: jest.fn(),
  };

  const spaceMemberRepoMock = {} as any;
  const eventEmitterMock = {
    emit: jest.fn(),
  } as any;

  let pageRepo: PageRepo;

  beforeEach(() => {
    jest.clearAllMocks();

    updateTableMock.mockReturnValue({ set: setMock });
    setMock.mockReturnValue({ where: whereMock });
    whereMock.mockReturnValue({ executeTakeFirst: executeTakeFirstMock });
    executeTakeFirstMock.mockResolvedValue({ numUpdatedRows: BigInt(1) });

    deleteWhereMock.mockReturnValue({ execute: deleteExecuteMock });
    deleteExecuteMock.mockResolvedValue(undefined);

    pageRepo = new PageRepo(dbMock as any, spaceMemberRepoMock, eventEmitterMock);
  });

  const createExpressionBuilderMock = () => {
    const expressionBuilder = ((column: string, operator: string, values: string[]) => ({
      type: 'comparison',
      column,
      operator,
      values,
    })) as any;

    expressionBuilder.or = (conditions: any[]) => ({
      type: 'or',
      conditions,
    });

    return expressionBuilder;
  };

  it('routes findById to UUID lookup for UUID values', async () => {
    const findByIdentifierSpy = jest
      .spyOn(pageRepo as any, 'findByIdentifier')
      .mockResolvedValue({ id: 'page-1' });

    await pageRepo.findById('0d75095b-cd06-43bc-9855-7956ec83f4fb');

    expect(findByIdentifierSpy).toHaveBeenCalledWith(
      'id',
      '0d75095b-cd06-43bc-9855-7956ec83f4fb',
      undefined,
    );
  });

  it('routes findById to slug lookup for non-UUID values', async () => {
    const findByIdentifierSpy = jest
      .spyOn(pageRepo as any, 'findByIdentifier')
      .mockResolvedValue({ id: 'page-1' });

    await pageRepo.findById('docs-home');

    expect(findByIdentifierSpy).toHaveBeenCalledWith('slugId', 'docs-home', undefined);
  });

  it('updates only by id when only UUID identifiers are provided', async () => {
    await pageRepo.updatePages(
      { workspaceId: 'workspace-1' },
      ['0d75095b-cd06-43bc-9855-7956ec83f4fb'],
    );

    const whereCallback = whereMock.mock.calls[0][0];
    const eb = createExpressionBuilderMock();
    const whereExpression = whereCallback(eb);

    expect(whereExpression).toEqual({
      type: 'comparison',
      column: 'id',
      operator: 'in',
      values: ['0d75095b-cd06-43bc-9855-7956ec83f4fb'],
    });
  });

  it('updates only by slugId when only slug identifiers are provided', async () => {
    await pageRepo.updatePages({ workspaceId: 'workspace-1' }, ['page-home']);

    const whereCallback = whereMock.mock.calls[0][0];
    const eb = createExpressionBuilderMock();
    const whereExpression = whereCallback(eb);

    expect(whereExpression).toEqual({
      type: 'comparison',
      column: 'slugId',
      operator: 'in',
      values: ['page-home'],
    });
  });

  it('updates by both columns when identifiers are mixed', async () => {
    await pageRepo.updatePages(
      { workspaceId: 'workspace-1' },
      ['0d75095b-cd06-43bc-9855-7956ec83f4fb', 'page-home'],
    );

    const whereCallback = whereMock.mock.calls[0][0];
    const eb = createExpressionBuilderMock();
    const whereExpression = whereCallback(eb);

    expect(whereExpression).toEqual({
      type: 'or',
      conditions: [
        {
          type: 'comparison',
          column: 'id',
          operator: 'in',
          values: ['0d75095b-cd06-43bc-9855-7956ec83f4fb'],
        },
        {
          type: 'comparison',
          column: 'slugId',
          operator: 'in',
          values: ['page-home'],
        },
      ],
    });

    expect(eventEmitterMock.emit).toHaveBeenCalledWith(EventName.PAGE_UPDATED, {
      pageIds: ['0d75095b-cd06-43bc-9855-7956ec83f4fb', 'page-home'],
      workspaceId: 'workspace-1',
    });
  });

  it('deletes by slugId for non-UUID identifier', async () => {
    await pageRepo.deletePage('docs-home');

    expect(deleteWhereMock).toHaveBeenCalledWith('slugId', '=', 'docs-home');
  });

  it('deletes by id for UUID identifier', async () => {
    await pageRepo.deletePage('0d75095b-cd06-43bc-9855-7956ec83f4fb');

    expect(deleteWhereMock).toHaveBeenCalledWith(
      'id',
      '=',
      '0d75095b-cd06-43bc-9855-7956ec83f4fb',
    );
  });

  it('resolves slug identifier before removePage recursive delete', async () => {
    const resolveSpy = jest
      .spyOn(pageRepo as any, 'resolvePageId')
      .mockResolvedValue('resolved-page-id');

    dbMock.withRecursive.mockImplementation((_name, callback) => {
      callback({
        selectFrom: jest.fn(() => ({
          select: jest.fn(() => ({
            where: jest.fn(() => ({ unionAll: jest.fn() })),
          })),
        })),
      });

      return {
        selectFrom: jest.fn(() => ({
          selectAll: jest.fn(() => ({
            execute: jest.fn().mockResolvedValue([{ id: 'resolved-page-id' }]),
          })),
        })),
      };
    });

    const trxMock = {
      updateTable: jest.fn(() => ({
        set: jest.fn(() => ({
          where: jest.fn(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
        })),
      })),
      deleteFrom: jest.fn(() => ({
        where: jest.fn(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
      })),
    };

    jest
      .spyOn(dbUtils, 'executeTx')
      .mockImplementation(async (_db, callback) => callback(trxMock as any));

    await pageRepo.removePage('docs-home', 'user-1', 'workspace-1');

    expect(resolveSpy).toHaveBeenCalledWith('docs-home');
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(EventName.PAGE_SOFT_DELETED, {
      pageIds: ['resolved-page-id'],
      workspaceId: 'workspace-1',
    });
  });

  it('resolves slug identifier before restorePage recursive restore', async () => {
    const resolveSpy = jest
      .spyOn(pageRepo as any, 'resolvePageId')
      .mockResolvedValue('resolved-page-id');

    dbMock.selectFrom.mockReturnValue({
      select: jest.fn(() => ({
        where: jest.fn(() => ({
          executeTakeFirst: jest
            .fn()
            .mockResolvedValueOnce({ id: 'resolved-page-id', parentPageId: null }),
        })),
      })),
    });

    dbMock.withRecursive.mockImplementation((_name, callback) => {
      callback({
        selectFrom: jest.fn(() => ({
          select: jest.fn(() => ({
            where: jest.fn(() => ({ unionAll: jest.fn() })),
          })),
        })),
      });

      return {
        selectFrom: jest.fn(() => ({
          selectAll: jest.fn(() => ({
            execute: jest.fn().mockResolvedValue([{ id: 'resolved-page-id' }]),
          })),
        })),
      };
    });

    dbMock.updateTable.mockReturnValue({
      set: jest.fn(() => ({
        where: jest.fn(() => ({ execute: jest.fn().mockResolvedValue(undefined) })),
      })),
    });

    await pageRepo.restorePage('docs-home', 'workspace-1');

    expect(resolveSpy).toHaveBeenCalledWith('docs-home');
    expect(eventEmitterMock.emit).toHaveBeenCalledWith(EventName.PAGE_RESTORED, {
      pageIds: ['resolved-page-id'],
      workspaceId: 'workspace-1',
    });
  });
});
