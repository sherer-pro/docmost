import {
  buildMessage,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

export const MAX_UTF8_BYTES = 'maxUtf8Bytes';

export function maxUtf8Bytes(value: unknown, maxBytes: number): boolean {
  return (
    typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= maxBytes
  );
}

/**
 * Rejects values that exceed a byte-oriented cryptographic input limit.
 */
export function MaxUtf8Bytes(
  maxBytes: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: MAX_UTF8_BYTES,
      constraints: [maxBytes],
      validator: {
        validate: (value): boolean => maxUtf8Bytes(value, maxBytes),
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be no longer than ${maxBytes} UTF-8 bytes`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
