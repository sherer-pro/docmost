import { readFileSync } from 'node:fs';

describe('page duplicate attachment pin migration', () => {
  const source = readFileSync(
    require.resolve(
      '../migrations/20260822T050000-page-duplicate-attachment-pins',
    ),
    'utf8',
  );

  it('pins active and failed duplicate work with a restrictive attachment FK', () => {
    expect(source).toContain(".onDelete('restrict')");
    expect(source).toContain("outbox.status in ('pending', 'processing', 'failed')");
    expect(source).toContain("attachment.id::text = mapping ->> 'oldAttachmentId'");
    expect(source).toContain('attachment.deleted_at is null');
    expect(source).toContain('with active_outbox as materialized');
    expect(source).toContain('for update');
    expect(source).toContain(
      "new.status in ('completed', 'cancelled')",
    );
  });

  it('fails closed on unpinnable work and undrained rollback', () => {
    expect(source).toContain('invalid active outbox payload');
    expect(source).toContain('source attachment is unavailable');
    expect(source).toContain(
      "status in ('pending', 'processing', 'failed')",
    );
    expect(source).toContain('duplicate attachment work is not drained');
  });
});
