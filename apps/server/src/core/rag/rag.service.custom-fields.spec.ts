jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { RagService } from './rag.service';

describe('RagService AI role custom field', () => {
  const service = new RagService(
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

  it('includes the normalized default only when the space field is enabled', () => {
    const enabledConfig = (service as any).getDocumentFieldsConfig({
      settings: { documentFields: { aiRole: true } },
    });
    const disabledConfig = (service as any).getDocumentFieldsConfig({
      settings: { documentFields: { aiRole: false } },
    });

    expect((service as any).buildCustomFields({}, enabledConfig)).toEqual({
      aiRole: 'NONE',
    });
    expect(
      (service as any).buildCustomFields({}, disabledConfig),
    ).toBeUndefined();
  });

  it('keeps valid values and normalizes malformed values', () => {
    const config = (service as any).getDocumentFieldsConfig({
      settings: { documentFields: { aiRole: true } },
    });

    expect(
      (service as any).buildCustomFields(
        { aiRole: 'COAUTHOR' },
        config,
      ),
    ).toEqual({ aiRole: 'COAUTHOR' });
    expect(
      (service as any).buildCustomFields(
        { aiRole: 'malformed' },
        config,
      ),
    ).toEqual({ aiRole: 'NONE' });
  });
});
