import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateAiAssistantProfileDto,
  UpdateAiAssistantProfileDto,
  UpdateAiAssistantProfilePreferencesDto,
} from './ai-assistant-profile.dto';

describe('assistant profile DTOs', () => {
  const validProfile = {
    name: 'Reviewer',
    icon: 'sparkles',
    instructions: 'Review the document.',
    allowedBuiltinCapabilities: ['search.query'],
    temperatureOverride: 0.5,
    maxOutputTokensOverride: 1024,
  };

  it('accepts a bounded exact-tool profile', async () => {
    const dto = plainToInstance(CreateAiAssistantProfileDto, validProfile);
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    { ...validProfile, name: 'x'.repeat(81) },
    { ...validProfile, instructions: 'x'.repeat(20_001) },
    { ...validProfile, chatModelOverride: 'x'.repeat(201) },
    { ...validProfile, temperatureOverride: 2.1 },
    { ...validProfile, maxOutputTokensOverride: 0 },
    { ...validProfile, allowedBuiltinCapabilities: ['unknown.tool'] },
  ])('rejects an invalid profile field set', async (value) => {
    const dto = plainToInstance(CreateAiAssistantProfileDto, value);
    expect(await validate(dto)).not.toEqual([]);
  });

  it('requires an optimistic version for updates', async () => {
    const dto = plainToInstance(UpdateAiAssistantProfileDto, {
      name: 'Renamed',
    });
    expect(await validate(dto)).not.toEqual([]);
  });

  it('rejects invalid hidden profile IDs', async () => {
    const dto = plainToInstance(UpdateAiAssistantProfilePreferencesDto, {
      preferredProfileId: '0198d444-2565-7a4c-9a1d-3c6b6dd4ed2f',
      hiddenProfileIds: ['not-a-uuid'],
    });
    expect(await validate(dto)).not.toEqual([]);
  });
});
