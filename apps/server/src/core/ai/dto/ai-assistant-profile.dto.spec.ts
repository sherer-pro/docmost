import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateAiAssistantProfileDto,
  UpdateAiAssistantProfileDto,
  UpdateAiAssistantProfilePreferencesDto,
} from './ai-assistant-profile.dto';

describe('assistant profile DTOs', () => {
  const bindingId = '0198d444-2565-7a4c-9a1d-3c6b6dd4ed2f';
  const groupId = '0198d444-2565-7a4c-9a1d-3c6b6dd4ed30';
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

  it('accepts Unicode at the documented string boundaries', async () => {
    const dto = plainToInstance(CreateAiAssistantProfileDto, {
      ...validProfile,
      name: 'Профиль 🧠',
      description: 'Описание'.repeat(50).slice(0, 500),
      instructions: '測'.repeat(20_000),
      chatModelOverride: 'модель-🧠',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    { field: 'name', value: '' },
    { field: 'instructions', value: '' },
    { field: 'icon', value: 'unknown-icon' },
    { field: 'description', value: 'x'.repeat(501) },
    { field: 'launchMessage', value: 'x'.repeat(2_001) },
  ])('rejects invalid required or bounded $field', async ({ field, value }) => {
    const dto = plainToInstance(CreateAiAssistantProfileDto, {
      ...validProfile,
      [field]: value,
    });

    expect(await validate(dto)).not.toEqual([]);
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

  it('rejects duplicate capabilities and invalid nested assignments', async () => {
    const duplicateCapabilities = plainToInstance(CreateAiAssistantProfileDto, {
      ...validProfile,
      allowedBuiltinCapabilities: ['search.query', 'search.query'],
    });
    const invalidRelations = plainToInstance(CreateAiAssistantProfileDto, {
      ...validProfile,
      allowedExternalTools: [
        { bindingId, toolName: '' },
        { bindingId: 'not-a-uuid', toolName: 'docs.search' },
      ],
      groupPolicies: [
        {
          groupId,
          available: true,
          allowedBuiltinCapabilities: ['unknown.tool'],
        },
      ],
    });

    expect(await validate(duplicateCapabilities)).not.toEqual([]);
    expect(await validate(invalidRelations)).not.toEqual([]);
  });

  it('enforces collection limits for tools, groups, commands, and preferences', async () => {
    const externalTools = Array.from({ length: 129 }, (_, index) => ({
      bindingId,
      toolName: `tool-${index}`,
    }));
    const groupPolicies = Array.from({ length: 101 }, () => ({
      groupId,
      available: true,
      allowedBuiltinCapabilities: null,
    }));
    const quickCommands = Array.from({ length: 51 }, (_, index) => ({
      id: `command-${index}`,
      label: `Command ${index}`,
      prompt: `Prompt ${index}`,
    }));
    const profile = plainToInstance(CreateAiAssistantProfileDto, {
      ...validProfile,
      allowedExternalTools: externalTools,
      groupPolicies,
      quickCommands,
    });
    const preferences = plainToInstance(
      UpdateAiAssistantProfilePreferencesDto,
      {
        preferredProfileId: null,
        hiddenProfileIds: Array.from(
          { length: 51 },
          (_, index) =>
            `0198d444-2565-7a4c-9a1d-${String(index).padStart(12, '0')}`,
        ),
      },
    );

    expect(await validate(profile)).not.toEqual([]);
    expect(await validate(preferences)).not.toEqual([]);
  });

  it('rejects duplicate hidden profile IDs', async () => {
    const dto = plainToInstance(UpdateAiAssistantProfilePreferencesDto, {
      preferredProfileId: bindingId,
      hiddenProfileIds: [bindingId, bindingId],
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
