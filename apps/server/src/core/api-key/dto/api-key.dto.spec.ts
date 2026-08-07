import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateApiKeyDto } from './api-key.dto';

describe('UpdateApiKeyDto', () => {
  const validPayload = {
    apiKeyId: '019fda1f-243c-7b30-9bc0-208dd05aec6c',
    name: 'Renamed key',
  };

  it('accepts the documented update shape', async () => {
    await expect(
      validate(plainToInstance(UpdateApiKeyDto, validPayload)),
    ).resolves.toHaveLength(0);
  });

  it.each(['keyType', 'spaceId', 'creatorId', 'expiresAt'] as const)(
    'rejects over-posting immutable %s',
    async (field) => {
      const errors = await validate(
        plainToInstance(UpdateApiKeyDto, {
          ...validPayload,
          [field]: field === 'keyType' ? 'rag' : 'immutable-value',
        }),
      );

      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            property: field,
            constraints: expect.objectContaining({
              equals: `${field} cannot be updated`,
            }),
          }),
        ]),
      );
    },
  );
});
