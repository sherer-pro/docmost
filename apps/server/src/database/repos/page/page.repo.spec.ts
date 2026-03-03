import { PageRepo } from './page.repo';
import { EventName } from '../../../common/events/event.contants';

describe('PageRepo.updatePages', () => {
  const updateTableMock = jest.fn();
  const setMock = jest.fn();
  const whereMock = jest.fn();
  const executeTakeFirstMock = jest.fn();

  const dbMock = {
    updateTable: updateTableMock,
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

  it('обновляет только по UUID, когда переданы только UUID-идентификаторы', async () => {
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

  it('обновляет только по slugId, когда переданы только slug-идентификаторы', async () => {
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

  it('обновляет по обеим колонкам, когда набор идентификаторов смешанный', async () => {
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
});
