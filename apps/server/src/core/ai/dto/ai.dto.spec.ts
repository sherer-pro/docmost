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
});
