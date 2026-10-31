import { EmptyPageTemplatePersistenceService } from './empty-page-template-persistence.service';
import { hashPageTemplateInstanceContent } from '../../common/helpers/prosemirror/page-template-content-hash';

describe('empty-page template persistence authorization', () => {
  function fixture() {
    const content = { type: 'doc', content: [{ type: 'paragraph' }] };
    const target = { id: 'target', workspaceId: 'workspace', spaceId: 'space', content } as any;
    const source = { ...target, id: 'source', templateKind: 'regular' };
    const user = { id: 'member', workspaceId: 'workspace', role: 'member' };
    const queries: Record<string, any> = {};
    const query = (table: string, result: unknown) => {
      const value: any = { executeTakeFirst: jest.fn().mockResolvedValue(result) };
      for (const method of ['selectAll', 'select', 'where', 'forUpdate', 'orderBy'])
        value[method] = jest.fn().mockReturnValue(value);
      queries[table] = value;
      return value;
    };
    query('users', user);
    query('pages', source);
    query('pageTemplateInstances', undefined);
    const insertion: any = { executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ id: 'instance' }) };
    insertion.values = jest.fn().mockReturnValue(insertion);
    insertion.returning = jest.fn().mockReturnValue(insertion);
    const trx = { selectFrom: jest.fn((table) => queries[table]), insertInto: jest.fn(() => insertion) };
    const access = { assertCanReadPage: jest.fn(), assertCanWritePage: jest.fn() };
    const policy = { assertAction: jest.fn() };
    const service = new EmptyPageTemplatePersistenceService(access as any, policy as any);
    const operation = { sourcePageId: source.id, attachmentMapping: [], applyMetadata: {
      kind: 'regular', sourceHash: hashPageTemplateInstanceContent(content), revision: null, attachmentRows: [],
    } };
    return { service, trx, target, source, user, queries, access, operation, insertion };
  }

  it('resolves the id-only collaboration actor from the current workspace before checking rights', async () => {
    const f = fixture();
    await f.service.apply(f.trx as any, f.target, f.operation, { id: f.user.id });
    expect(f.queries.users.where).toHaveBeenCalledWith('workspaceId', '=', f.target.workspaceId);
    expect(f.access.assertCanWritePage).toHaveBeenCalledWith(f.target, f.user);
    expect(f.access.assertCanReadPage).toHaveBeenCalledWith(f.source, f.user);
    expect(f.trx.insertInto).toHaveBeenCalledWith('pageTemplateInstances');
  });

  it('rejects a deleted or cross-workspace actor before writing', async () => {
    const f = fixture();
    f.queries.users.executeTakeFirst.mockResolvedValue(undefined);
    await expect(f.service.apply(f.trx as any, f.target, f.operation, { id: 'removed' })).rejects.toMatchObject({ status: 403 });
    expect(f.trx.insertInto).not.toHaveBeenCalled();
  });

  it('rejects revoked write access before storing attachments or provenance', async () => {
    const f = fixture();
    f.access.assertCanWritePage.mockRejectedValue({ status: 403 });
    await expect(f.service.apply(f.trx as any, f.target, f.operation, { id: f.user.id })).rejects.toMatchObject({ status: 403 });
    expect(f.trx.insertInto).not.toHaveBeenCalled();
  });

  it('rejects a changed source and keeps the target untouched', async () => {
    const f = fixture();
    f.operation.applyMetadata.sourceHash = 'changed';
    await expect(f.service.apply(f.trx as any, f.target, f.operation, { id: f.user.id })).rejects.toMatchObject({ status: 409 });
    expect(f.trx.insertInto).not.toHaveBeenCalled();
  });
});
