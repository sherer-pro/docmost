import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import { DictionaryWordFormService } from './dictionary-word-form.service';

describe('DictionaryWordFormService', () => {
  const config = {
    enabled: true,
    baseUrl: 'http://provider.test/v1',
    chatModel: 'model-1',
  } as any;
  const configs = {
    getRawConfig: jest.fn(),
    toProviderConfig: jest.fn().mockReturnValue({
      baseUrl: 'http://provider.test/v1',
      chatModel: 'model-1',
      temperature: 0.2,
      maxOutputTokens: 8192,
      requestTimeoutMs: 300000,
    }),
  };
  const provider = {
    complete: jest.fn(),
  };
  const dictionary = {
    listTerms: jest.fn(),
    mergeGeneratedForms: jest.fn(
      (_term: string, existing: string[], generated: string[]) => [
        ...existing,
        ...generated,
      ],
    ),
    replaceFormsForTerms: jest.fn(),
  };
  const service = new DictionaryWordFormService(
    configs as any,
    provider as any,
    dictionary as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    configs.getRawConfig.mockResolvedValue(config);
    configs.toProviderConfig.mockReturnValue({
      baseUrl: 'http://provider.test/v1',
      chatModel: 'model-1',
      temperature: 0.2,
      maxOutputTokens: 8192,
      requestTimeoutMs: 300000,
    });
    dictionary.mergeGeneratedForms.mockImplementation(
      (_term: string, existing: string[], generated: string[]) => [
        ...existing,
        ...generated,
      ],
    );
  });

  it('reports availability only for an enabled configured provider', async () => {
    await expect(
      service.getAvailability('space-1', 'workspace-1'),
    ).resolves.toEqual({ available: true });

    configs.getRawConfig.mockResolvedValue({
      ...config,
      enabled: false,
    });
    await expect(
      service.getAvailability('space-1', 'workspace-1'),
    ).resolves.toEqual({ available: false });
  });

  it('generates forms for one term without saving them', async () => {
    provider.complete.mockResolvedValue({
      content:
        '```json\n{"items":[{"index":0,"forms":["термина","термины"]}]}\n```',
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    await expect(
      service.generateForms('space-1', 'workspace-1', {
        term: ' Термин ',
        forms: ['терм.'],
      }),
    ).resolves.toEqual({ forms: ['терм.', 'термина', 'термины'] });

    expect(dictionary.mergeGeneratedForms).toHaveBeenCalledWith(
      'Термин',
      ['терм.'],
      ['термина', 'термины'],
    );
    expect(dictionary.replaceFormsForTerms).not.toHaveBeenCalled();
  });

  it('retries an invalid provider response and then fails closed', async () => {
    provider.complete.mockResolvedValue({
      content: 'not-json',
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await expect(
      service.generateForms('space-1', 'workspace-1', {
        term: 'Alpha',
        forms: [],
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('rejects generation when AI is unavailable in the space', async () => {
    configs.getRawConfig.mockResolvedValue({ ...config, enabled: false });

    await expect(
      service.generateForms('space-1', 'workspace-1', {
        term: 'Alpha',
        forms: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('generates every term before delegating the atomic bulk save', async () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    dictionary.listTerms.mockResolvedValue([
      {
        id: 'term-1',
        term: 'Alpha',
        forms: ['Alphas'],
        updatedAt,
      },
      {
        id: 'term-2',
        term: 'Beta',
        forms: [],
        updatedAt,
      },
    ]);
    provider.complete.mockResolvedValue({
      content:
        '{"items":[{"index":0,"forms":["Alpha form"]},{"index":1,"forms":["Beta form"]}]}',
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    dictionary.replaceFormsForTerms.mockResolvedValue({
      updatedTerms: 2,
      generatedForms: 2,
    });

    await expect(
      service.generateAndSaveAll('space-1', 'workspace-1'),
    ).resolves.toEqual({ updatedTerms: 2, generatedForms: 2 });

    expect(dictionary.replaceFormsForTerms).toHaveBeenCalledWith(
      'space-1',
      'workspace-1',
      [
        {
          id: 'term-1',
          term: 'Alpha',
          updatedAt,
          forms: ['Alphas', 'Alpha form'],
        },
        {
          id: 'term-2',
          term: 'Beta',
          updatedAt,
          forms: ['Beta form'],
        },
      ],
    );
  });
});
