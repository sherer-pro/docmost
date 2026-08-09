import { QueueJob } from '../constants';
import { DuplicatePageAttachmentsService } from './duplicate-page-attachments.service';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const SPACE_ID = '00000000-0000-4000-8000-000000000002';
const OLD_PAGE_ID = '00000000-0000-4000-8000-000000000003';
const NEW_PAGE_ID = '00000000-0000-4000-8000-000000000004';
const OLD_ATTACHMENT_ID_1 = '00000000-0000-4000-8000-000000000005';
const OLD_ATTACHMENT_ID_2 = '00000000-0000-4000-8000-000000000006';
const NEW_ATTACHMENT_ID_1 = '00000000-0000-4000-8000-000000000007';
const NEW_ATTACHMENT_ID_2 = '00000000-0000-4000-8000-000000000008';

function sourceAttachment(id: string) {
  return {
    id,
    type: 'file',
    filePath: `workspace/${id}/document.pdf`,
    fileName: 'document.pdf',
    fileSize: 42,
    mimeType: 'application/pdf',
    fileExt: '.pdf',
    creatorId: '00000000-0000-4000-8000-000000000009',
    workspaceId: WORKSPACE_ID,
    pageId: OLD_PAGE_ID,
    textContent: null,
    contentIndexStatus: 'pending',
    contentIndexVersion: 1,
    contentIndexedAt: null,
  };
}

function mapping(oldAttachmentId: string, newAttachmentId: string) {
  return {
    oldAttachmentId,
    newAttachmentId,
    oldPageId: OLD_PAGE_ID,
    newPageId: NEW_PAGE_ID,
  };
}

function query(result: unknown, terminal: 'execute' | 'executeTakeFirst') {
  const builder: Record<string, jest.Mock> = {};
  for (const method of ['select', 'where']) {
    builder[method] = jest.fn(() => builder);
  }
  builder[terminal] = jest.fn().mockResolvedValue(result);
  return builder;
}

describe('DuplicatePageAttachmentsService recovery', () => {
  it('resumes a partial copy without recopying a consistent destination', async () => {
    const sources = [
      sourceAttachment(OLD_ATTACHMENT_ID_1),
      sourceAttachment(OLD_ATTACHMENT_ID_2),
    ];
    const firstPath = sources[0].filePath.replace(
      OLD_ATTACHMENT_ID_1,
      NEW_ATTACHMENT_ID_1,
    );
    const sourceQuery = query(sources, 'execute');
    const existingQueries = [
      query(
        {
          id: NEW_ATTACHMENT_ID_1,
          workspaceId: WORKSPACE_ID,
          pageId: NEW_PAGE_ID,
          spaceId: SPACE_ID,
          filePath: firstPath,
          fileExt: '.pdf',
          textContent: null,
        },
        'executeTakeFirst',
      ),
      query(undefined, 'executeTakeFirst'),
    ];
    const insertQuery: Record<string, jest.Mock> = {};
    insertQuery.values = jest.fn(() => insertQuery);
    insertQuery.execute = jest.fn().mockResolvedValue(undefined);
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(sourceQuery)
        .mockImplementation(() => existingQueries.shift()),
      insertInto: jest.fn(() => insertQuery),
    };
    const storage = {
      exists: jest.fn().mockResolvedValue(true),
      copy: jest.fn().mockResolvedValue(undefined),
    };
    const searchQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const attachmentQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new DuplicatePageAttachmentsService(
      db as any,
      storage as any,
      searchQueue as any,
      attachmentQueue as any,
    );

    await service.process({
      workspaceId: WORKSPACE_ID,
      rootPageId: OLD_PAGE_ID,
      newPageId: NEW_PAGE_ID,
      spaceId: SPACE_ID,
      attachmentMappings: [
        mapping(OLD_ATTACHMENT_ID_1, NEW_ATTACHMENT_ID_1),
        mapping(OLD_ATTACHMENT_ID_2, NEW_ATTACHMENT_ID_2),
      ],
    });

    expect(storage.exists).toHaveBeenCalledWith(firstPath);
    expect(storage.copy).toHaveBeenCalledTimes(1);
    expect(storage.copy).toHaveBeenCalledWith(
      sources[1].filePath,
      sources[1].filePath.replace(
        OLD_ATTACHMENT_ID_2,
        NEW_ATTACHMENT_ID_2,
      ),
    );
    expect(insertQuery.execute).toHaveBeenCalledTimes(1);
    expect(searchQueue.add).toHaveBeenCalledWith(
      QueueJob.SEARCH_INDEX_ATTACHMENT,
      { attachmentIds: [NEW_ATTACHMENT_ID_1, NEW_ATTACHMENT_ID_2] },
      expect.anything(),
    );
    expect(attachmentQueue.add).toHaveBeenCalledTimes(2);
  });

  it('does not alias an inconsistent destination attachment', async () => {
    const source = sourceAttachment(OLD_ATTACHMENT_ID_1);
    const sourceQuery = query([source], 'execute');
    const existingQuery = query(
      {
        id: NEW_ATTACHMENT_ID_1,
        workspaceId: '00000000-0000-4000-8000-000000000099',
        pageId: NEW_PAGE_ID,
        spaceId: SPACE_ID,
        filePath: source.filePath.replace(
          OLD_ATTACHMENT_ID_1,
          NEW_ATTACHMENT_ID_1,
        ),
      },
      'executeTakeFirst',
    );
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(sourceQuery)
        .mockReturnValueOnce(existingQuery),
      insertInto: jest.fn(),
    };
    const storage = { exists: jest.fn(), copy: jest.fn() };
    const searchQueue = { add: jest.fn() };
    const attachmentQueue = { add: jest.fn() };
    const service = new DuplicatePageAttachmentsService(
      db as any,
      storage as any,
      searchQueue as any,
      attachmentQueue as any,
    );

    await expect(
      service.process({
        workspaceId: WORKSPACE_ID,
        rootPageId: OLD_PAGE_ID,
        newPageId: NEW_PAGE_ID,
        spaceId: SPACE_ID,
        attachmentMappings: [
          mapping(OLD_ATTACHMENT_ID_1, NEW_ATTACHMENT_ID_1),
        ],
      }),
    ).rejects.toThrow('duplicate_attachments_partial_failure');

    expect(storage.exists).not.toHaveBeenCalled();
    expect(storage.copy).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(searchQueue.add).not.toHaveBeenCalled();
    expect(attachmentQueue.add).not.toHaveBeenCalled();
  });
});
