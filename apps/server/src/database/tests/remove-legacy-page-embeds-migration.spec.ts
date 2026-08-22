import { readFileSync } from 'node:fs';

describe('legacy pageEmbed removal migration contract', () => {
  const source = readFileSync(
    require.resolve('../migrations/20260822T040000-remove-legacy-page-embeds'),
    'utf8',
  );

  it('fails closed while persisted whole-page embed data remains', () => {
    expect(source).toContain('pages still contain pageEmbed data');
    expect(source).toContain('page history still contains pageEmbed nodes');
    expect(source).toContain("coalesce(change_data, 'null'::jsonb)");
    expect(source).toContain('synced block data still contains pageEmbed nodes');
    expect(source).toContain('whole-page reference rows still exist');
    expect(source).toContain('pending embed operations still exist');
    expect(source).toContain(
      'failed embed operations retain cleanup evidence',
    );
    expect(source).toContain(
      "coalesce(attachment_mapping, 'null'::jsonb) not in",
    );
    expect(source).toContain("coalesce(staged_content, 'null'::jsonb) not in");
    expect(source).not.toContain(
      "position(convert_to('pageEmbed', 'UTF8') in ydoc)",
    );
    expect(source).toContain('page_embed_removal_ledger');
    expect(source).toContain('page_embed_attachment_clone_ledger');
    expect(source).toContain('attachment clones are incomplete');
    expect(source).toContain(
      'completed attachment clone ownership is inconsistent',
    );
    expect(source).toContain(
      'page content changed after semantic cleanup verification',
    );
    expect(source).toContain(
      'orphan block transclusion references still exist',
    );
    expect(source).toContain(
      'transclusion reference workspace ownership is inconsistent',
    );
    expect(source).toContain(
      "hashtextextended('docmost-page-embed-removal', 0)",
    );
  });

  it('keeps only modern operation kinds after removing terminal legacy rows', () => {
    const narrowedConstraint = source.slice(
      source.indexOf('drop index if exists page_template_operations_detach'),
      source.indexOf(
        'drop index if exists page_transclusion_references_page_node_unique',
      ),
    );
    expect(narrowedConstraint).toContain("'snapshot'");
    expect(narrowedConstraint).toContain("'page_duplicate'");
    expect(narrowedConstraint).toContain("'template_sync'");
    expect(narrowedConstraint).toContain("'template_detach'");
    expect(narrowedConstraint).not.toContain("'embed_insert'");
    expect(narrowedConstraint).not.toContain("'embed_detach'");
    expect(narrowedConstraint).not.toContain("'legacy_embed_migration'");
  });

  it('drops retired graph, reference, and migration-error schema', () => {
    expect(source).toContain("dropTable('page_embed_graph_fences')");
    expect(source).toContain("dropTable('page_template_legacy_migration_errors')");
    expect(source).toContain('drop column if exists reference_node_id');
    expect(source).toContain('drop column if exists reference_kind');
    expect(source).toContain('alter column transclusion_id set not null');
  });

  it('restores block-reference ownership and removes it before down expands the schema', () => {
    expect(source).toContain(
      'add constraint page_transclusion_references_source_page_id_fkey',
    );
    expect(source).toContain(
      'foreign key (source_page_id) references pages(id) on delete cascade',
    );
    const down = source.slice(source.indexOf('export async function down'));
    expect(
      down.indexOf(
        'drop constraint if exists page_transclusion_references_source_page_id_fkey',
      ),
    ).toBeLessThan(down.indexOf('alter column transclusion_id drop not null'));
  });
});
