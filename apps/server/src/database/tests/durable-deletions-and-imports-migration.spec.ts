import { readFileSync } from 'node:fs';

describe('durable deletions and imports migration contract', () => {
  const source = readFileSync(
    require.resolve('../migrations/20260822T010000-durable-deletions-and-imports'),
    'utf8',
  );

  it('recovers confirmed Docmost imports without admitting unconfirmed previews', () => {
    expect(source).toContain("source in ('generic', 'notion', 'docmost')");
    expect(source).toContain("source != 'docmost' or options is not null");
  });

  it('retains archive locators and cleanup intents for historical successes', () => {
    expect(source).toContain(
      "status in ('uploading', 'pending', 'processing', 'success', 'failed')",
    );
    expect(source).toContain("status = 'success'");
  });

  it('fails rollback while durable work or uncompensated paths remain', () => {
    expect(source).toContain(
      'durable deletion rollback blocked: attachment cleanup is not drained',
    );
    expect(source).toContain(
      'durable import rollback blocked: active imports are not drained',
    );
    expect(source).toContain(
      'durable import rollback blocked: storage artifacts are not compensated',
    );
  });
});
