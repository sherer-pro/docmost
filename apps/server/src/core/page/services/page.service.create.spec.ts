jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { PageService } from './page.service';

const PAGE_ID = '00000000-0000-4000-8000-000000000001';

describe('PageService create', () => {
  const pageRepo = {
    findById: jest.fn(),
    insertPage: jest.fn(),
  };
  const userRepo = {
    updatePageEditModeByPageId: jest.fn(),
  };
  const generalQueue = {
    add: jest.fn(async () => undefined),
  };

  const service = new PageService(
    pageRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    generalQueue as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    userRepo as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service, 'nextPagePosition').mockResolvedValue('a0');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sets the creator page edit override to edit for a newly created page', async () => {
    pageRepo.insertPage.mockResolvedValue({
      id: PAGE_ID,
      title: '',
      slugId: 'slug-1',
      position: 'a0',
      parentPageId: null,
      spaceId: 'space-1',
      workspaceId: 'ws-1',
    });

    await service.create('user-1', 'ws-1', {
      spaceId: 'space-1',
      title: '',
    });

    expect(userRepo.updatePageEditModeByPageId).toHaveBeenCalledWith(
      'user-1',
      'ws-1',
      PAGE_ID,
      'edit',
    );
  });
});
