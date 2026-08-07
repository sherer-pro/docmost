import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  UpdateAiOpenWebUiRetrievalConfigDto,
  UpdateAiRetrievalConfigDto,
  UpdateAiSpaceConfigDto,
} from './ai.dto';

describe('AI configuration DTOs', () => {
  it('loads nested Open WebUI DTO metadata without a declaration-order cycle', () => {
    expect(new UpdateAiRetrievalConfigDto()).toBeInstanceOf(
      UpdateAiRetrievalConfigDto,
    );
    expect(new UpdateAiOpenWebUiRetrievalConfigDto()).toBeInstanceOf(
      UpdateAiOpenWebUiRetrievalConfigDto,
    );
  });

  it('accepts a valid Unicode assistant identity', async () => {
    const dto = plainToInstance(UpdateAiSpaceConfigDto, {
      assistantNameEnabled: true,
      assistantName: '  Алиса 🤖 / R&D  ',
      assistantGender: 'feminine',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    ['unsupported gender', { assistantGender: 'neutral' }],
    ['line break', { assistantName: 'Alice\nAdmin' }],
    ['control character', { assistantName: 'Alice\u0007' }],
    ['bidi control', { assistantName: 'Alice\u202e' }],
    ['name over the limit', { assistantName: 'А'.repeat(81) }],
  ])('rejects %s in assistant identity', async (_case, payload) => {
    const dto = plainToInstance(UpdateAiSpaceConfigDto, payload);

    expect(await validate(dto)).not.toEqual([]);
  });

  it.each([
    ['empty model', { chatModel: '' }],
    ['temperature above the provider boundary', { temperature: 2.01 }],
    ['timeout below one second', { requestTimeoutMs: 999 }],
    ['timeout above ten minutes', { requestTimeoutMs: 600001 }],
    ['context window below the minimum', { contextWindow: 1023 }],
    ['output limit above the maximum', { maxOutputTokens: 131073 }],
    ['too many quick commands', { quickCommands: Array.from({ length: 51 }, (_, index) => ({ id: `command-${index}`, label: `Command ${index}`, prompt: 'Prompt' })) }],
  ])('rejects %s', async (_case, payload) => {
    const dto = plainToInstance(UpdateAiSpaceConfigDto, payload);
    expect(await validate(dto)).not.toEqual([]);
  });

  it('accepts the documented provider and generation boundaries', async () => {
    const dto = plainToInstance(UpdateAiSpaceConfigDto, {
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:1080/v1',
      chatModel: 'docmost-audit-model',
      temperature: 0,
      requestTimeoutMs: 600000,
      contextWindow: 2000000,
      maxOutputTokens: 131072,
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });
});
