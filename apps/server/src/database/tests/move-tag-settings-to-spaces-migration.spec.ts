import {
  down,
  up,
} from '../migrations/20260820T120000-move-tag-settings-to-spaces';

function createRecordingDb() {
  const statements: string[] = [];
  const db: any = {
    getExecutor: () => ({
      transformQuery: (node: unknown) => node,
      compileQuery: (node: any) => ({
        sql: (node.sqlFragments ?? []).join(''),
        parameters: [],
      }),
      executeQuery: async (compiled: { sql: string }) => {
        statements.push(compiled.sql.replace(/\s+/g, ' ').trim());
        return { rows: [] };
      },
      provideConnection: async (consumer: any) => consumer({}),
    }),
  };

  return { db, statements };
}

describe('move tag settings to spaces migration', () => {
  it('copies the legacy disabled array to every space and removes the workspace key', async () => {
    const { db, statements } = createRecordingDb();

    await up(db);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('UPDATE spaces AS space');
    expect(statements[0]).toContain("workspace.settings #> '{tags,disabled}'");
    expect(statements[0]).toContain('workspace.id = space.workspace_id');
    expect(statements[1]).toContain(
      "settings = COALESCE(settings, '{}'::jsonb) - 'tags'",
    );
    expect(statements[1]).toContain('UPDATE workspaces');
  });

  it('guards divergent space settings before restoring the workspace key', async () => {
    const { db, statements } = createRecordingDb();

    await down(db);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain('HAVING COUNT( DISTINCT COALESCE(');
    expect(statements[0]).toContain('RAISE EXCEPTION');
    expect(statements[1]).toContain('UPDATE workspaces AS workspace');
    expect(statements[1]).toContain("SELECT space.settings -> 'tags'");
    expect(statements[2]).toContain('UPDATE spaces');
    expect(statements[2]).toContain(
      "settings = COALESCE(settings, '{}'::jsonb) - 'tags'",
    );
  });
});
