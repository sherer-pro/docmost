import { KnowledgeProjectionService } from './knowledge-projection.service';

describe('KnowledgeProjectionService', () => {
  const service = new KnowledgeProjectionService({} as any);

  it('includes projection version, field mask, and dictionary switch in the fingerprint input', () => {
    expect(
      service.fingerprintInput({
        settings: {
          documentFields: {
            status: true,
            assignee: false,
            stakeholders: true,
            aiRole: true,
          },
          dictionary: { enabled: true },
        },
      } as any),
    ).toEqual({
      projectionVersion: 1,
      documentFields: {
        status: true,
        assignee: false,
        stakeholders: true,
        aiRole: true,
      },
      dictionaryEnabled: true,
    });
  });

  it('emits enabled empty fields explicitly and omits disabled fields', () => {
    expect(
      service.buildCustomFields(
        { aiRole: 'invalid' },
        {
          status: true,
          assignee: true,
          stakeholders: true,
          aiRole: true,
        },
      ),
    ).toEqual({
      status: null,
      assigneeId: null,
      stakeholderIds: [],
      aiRole: 'NONE',
    });
    expect(
      service.buildCustomFields(
        {
          status: 'In progress',
          assigneeId: 'member-1',
          stakeholderIds: ['member-2'],
          aiRole: 'AUTHOR',
        },
        {
          status: false,
          assignee: false,
          stakeholders: false,
          aiRole: false,
        },
      ),
    ).toBeUndefined();
  });

  it('renders display names without email and fails safely for unknown members', () => {
    const markdown = service.renderDocumentFields(
      {
        status: 'Review',
        assigneeId: 'member-1',
        stakeholderIds: ['missing-member'],
        aiRole: 'COAUTHOR',
      },
      new Map([['member-1', 'Ada Lovelace']]),
    );

    expect(markdown).toContain('- Assignee: Ada Lovelace');
    expect(markdown).toContain(
      '- Stakeholders: Unknown member (missing-member)',
    );
    expect(markdown).not.toContain('@');
  });

  it('renders schema options and every named cell including empty values', () => {
    const properties = [
      {
        id: 'status-property',
        name: 'Stage',
        type: 'status',
        settings: { options: [{ name: 'Ready' }, { name: 'Done' }] },
      },
      { id: 'owner-property', name: 'Owner note', type: 'text' },
    ];

    expect(service.renderDatabaseSchema(properties)).toContain(
      '- Stage (status; options: Ready, Done)',
    );
    expect(
      service.renderRowFields(properties, [
        { propertyId: 'status-property', value: 'Ready' },
      ]),
    ).toEqual({
      cells: [
        {
          propertyId: 'status-property',
          propertyName: 'Stage',
          propertyType: 'status',
          value: 'Ready',
        },
        {
          propertyId: 'owner-property',
          propertyName: 'Owner note',
          propertyType: 'text',
          value: null,
        },
      ],
      markdown: '## Database fields\n\n- Stage: Ready\n- Owner note: Not set',
    });
  });

  it('uses only referenced member timestamps for the projection timestamp', () => {
    const sourceUpdatedAt = new Date('2026-08-20T10:00:00.000Z');
    const result = service.projectionUpdatedAtFromMembers(
      sourceUpdatedAt,
      { assigneeId: 'member-1', stakeholderIds: ['member-2'] },
      new Map([
        [
          'member-1',
          {
            name: 'Member One',
            updatedAt: new Date('2026-08-20T11:00:00.000Z'),
          },
        ],
        [
          'unreferenced-member',
          {
            name: 'Unreferenced',
            updatedAt: new Date('2026-08-20T12:00:00.000Z'),
          },
        ],
      ]),
    );

    expect(result.toISOString()).toBe('2026-08-20T11:00:00.000Z');
  });
});
