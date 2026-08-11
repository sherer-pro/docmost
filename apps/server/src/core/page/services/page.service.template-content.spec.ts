jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { PageService } from './page.service';

const PAGE_ID = '00000000-0000-4000-8000-000000000001';
const MANAGED_ID = '00000000-0000-4000-8000-000000000002';
const FIELD_ID = '00000000-0000-4000-8000-000000000003';

const content = (managedText: string, fieldText: string) => ({
  type: 'doc',
  content: [
    {
      type: 'templateManagedBlock',
      attrs: { templateBlockId: MANAGED_ID, locked: true },
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: managedText }],
        },
      ],
    },
    {
      type: 'templateField',
      attrs: { fieldId: FIELD_ID, label: 'Owner', placeholder: '' },
      content: [
        fieldText
          ? {
              type: 'paragraph',
              content: [{ type: 'text', text: fieldText }],
            }
          : { type: 'paragraph' },
      ],
    },
  ],
});

describe('PageService synchronized template content guard', () => {
  const pageRepo = { findById: jest.fn() };
  const collaborationGateway = { updatePageContent: jest.fn() };
  const activeInstanceQuery: any = {
    select: jest.fn(() => activeInstanceQuery),
    where: jest.fn(() => activeInstanceQuery),
    executeTakeFirst: jest.fn(),
  };
  const db = {
    selectFrom: jest.fn(() => activeInstanceQuery),
  };
  const service = new PageService(
    pageRepo as any,
    {} as any,
    db as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    collaborationGateway as any,
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
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(service as any, 'parseProsemirrorContent')
      .mockImplementation(async (value: unknown) => value);
    activeInstanceQuery.executeTakeFirst.mockResolvedValue({ id: 'instance' });
    pageRepo.findById.mockResolvedValue({ content: content('Managed v1', '') });
    collaborationGateway.updatePageContent.mockResolvedValue(undefined);
  });

  it('rejects a managed block change before opening the live document', async () => {
    await expect(
      service.updatePageContent(
        PAGE_ID,
        content('Bypass', ''),
        'replace',
        'json',
        { id: 'user-1' } as any,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'page_template_managed_content_read_only',
      },
      status: 409,
    });

    expect(collaborationGateway.updatePageContent).not.toHaveBeenCalled();
  });

  it('allows local field values while keeping managed content unchanged', async () => {
    await service.updatePageContent(
      PAGE_ID,
      content('Managed v1', 'Member value'),
      'replace',
      'json',
      { id: 'user-1' } as any,
    );

    expect(collaborationGateway.updatePageContent).toHaveBeenCalledTimes(1);
  });

  it('rejects appended managed nodes before opening the live document', async () => {
    await expect(
      service.updatePageContent(
        PAGE_ID,
        {
          type: 'doc',
          content: [content('Nested bypass', '').content[0]],
        },
        'append',
        'json',
        { id: 'user-1' } as any,
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'page_template_managed_content_read_only',
      },
      status: 409,
    });

    expect(collaborationGateway.updatePageContent).not.toHaveBeenCalled();
  });
});
