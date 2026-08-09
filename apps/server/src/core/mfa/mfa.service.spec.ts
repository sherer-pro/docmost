import { BadRequestException } from '@nestjs/common';
import { MfaService } from './mfa.service';
import {
  encryptProtectedValue,
  hashKeyedProtectedValue,
  isKeyedHashedProtectedValue,
} from '../../common/security/credential-protection.util';
import * as OTPAuth from 'otpauth';

describe('MfaService security helpers', () => {
  const appSecret = 'very-strong-app-secret-for-tests-only';

  const createSerializedMfaDb = (
    row: Record<string, any>,
    challengeState?: { active: boolean },
  ) => {
    let transactionTail = Promise.resolve();
    const selectQuery: any = {
      selectAll: jest.fn(() => selectQuery),
      where: jest.fn(() => selectQuery),
      forUpdate: jest.fn(() => selectQuery),
      executeTakeFirst: jest.fn(async () => ({ ...row })),
    };
    let pendingUpdate: Record<string, any> = {};
    const updateQuery: any = {
      set: jest.fn((values: Record<string, any>) => {
        pendingUpdate = values;
        return updateQuery;
      }),
      where: jest.fn(() => updateQuery),
      execute: jest.fn(async () => {
        Object.assign(row, pendingUpdate);
      }),
    };
    const challengeUpdateQuery: any = {
      set: jest.fn(() => challengeUpdateQuery),
      where: jest.fn(() => challengeUpdateQuery),
      returning: jest.fn(() => challengeUpdateQuery),
      executeTakeFirst: jest.fn(async () => {
        if (!challengeState?.active) {
          return undefined;
        }
        challengeState.active = false;
        return { id: 'challenge-1' };
      }),
    };
    const trx = {
      selectFrom: jest.fn(() => selectQuery),
      updateTable: jest.fn((table: string) =>
        table === 'userTokens' ? challengeUpdateQuery : updateQuery,
      ),
    };
    const transaction = {
      execute: jest.fn((callback: (trx: any) => Promise<any>) => {
        const result = transactionTail.then(() => callback(trx));
        transactionTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      }),
    };

    return {
      transaction: jest.fn(() => transaction),
    };
  };

  const createService = () =>
    new MfaService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { getAppSecret: () => appSecret } as any,
      {} as any,
      {} as any,
    );

  it('hashBackupCodes stores backup codes as application-keyed hashes', () => {
    const service = createService();

    const hashed = (service as any).hashBackupCodes(['ABCD1234', 'ZXCV5678']);

    expect(hashed).toHaveLength(2);
    expect(isKeyedHashedProtectedValue(hashed[0])).toBe(true);
    expect(isKeyedHashedProtectedValue(hashed[1])).toBe(true);
  });

  it('consumeBackupCode removes a matching keyed backup code', () => {
    const service = createService();

    const result = (service as any).consumeBackupCode('abcd1234', [
      hashKeyedProtectedValue('ABCD1234', appSecret),
      hashKeyedProtectedValue('ZXCV5678', appSecret),
    ]);

    expect(result.matched).toBe(true);
    expect(result.remaining).toHaveLength(1);
    expect(isKeyedHashedProtectedValue(result.remaining[0])).toBe(true);
  });

  it('getTotpSecret decrypts encrypted values and rejects legacy plaintext', () => {
    const service = createService();
    const encrypted = encryptProtectedValue('BASE32SECRET', appSecret);

    expect((service as any).getTotpSecret(encrypted)).toBe('BASE32SECRET');
    expect(() => (service as any).getTotpSecret('LEGACYSECRET')).toThrow(
      BadRequestException,
    );
  });

  it('getTotpSecret rejects invalid encrypted payloads', () => {
    const service = createService();

    expect(() => (service as any).getTotpSecret('enc:v1:broken')).toThrow(
      BadRequestException,
    );
  });

  it('accepts a TOTP counter only once across concurrent verification attempts', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T20:00:00.000Z'));
    try {
      const secret = new OTPAuth.Secret({ size: 20 }).base32;
      const row = {
        id: 'mfa-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        isEnabled: true,
        secret: encryptProtectedValue(secret, appSecret),
        backupCodes: [],
        lastUsedTotpCounter: null,
      };
      const service = new MfaService(
        createSerializedMfaDb(row) as any,
        {} as any,
        {} as any,
        {} as any,
        { getAppSecret: () => appSecret } as any,
        {} as any,
        {} as any,
      );
      const totp = new OTPAuth.TOTP({
        issuer: 'Docmost',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret,
      });
      const code = totp.generate({ timestamp: Date.now() });

      const results = await Promise.all([
        (service as any).consumeVerificationCode('user-1', 'workspace-1', code),
        (service as any).consumeVerificationCode('user-1', 'workspace-1', code),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('consumes an MFA login challenge only once across concurrent codes', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-06T20:00:00.000Z'));
    try {
      const secret = new OTPAuth.Secret({ size: 20 }).base32;
      const row = {
        id: 'mfa-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        isEnabled: true,
        secret: encryptProtectedValue(secret, appSecret),
        backupCodes: [],
        lastUsedTotpCounter: null,
      };
      const challengeState = { active: true };
      const service = new MfaService(
        createSerializedMfaDb(row, challengeState) as any,
        {} as any,
        {} as any,
        {} as any,
        { getAppSecret: () => appSecret } as any,
        {} as any,
        {} as any,
      );
      const totp = new OTPAuth.TOTP({
        issuer: 'Docmost',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret,
      });
      const firstCode = totp.generate({ timestamp: Date.now() });
      const secondCode = totp.generate({ timestamp: Date.now() + 30_000 });

      const results = await Promise.all([
        (service as any).consumeVerificationCode(
          'user-1',
          'workspace-1',
          firstCode,
          'challenge-raw',
        ),
        (service as any).consumeVerificationCode(
          'user-1',
          'workspace-1',
          secondCode,
          'challenge-raw',
        ),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      expect(challengeState.active).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('consumes a backup code only once across concurrent attempts', async () => {
    const backupCode = 'ABCD1234';
    const row = {
      id: 'mfa-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      isEnabled: true,
      secret: encryptProtectedValue(
        new OTPAuth.Secret({ size: 20 }).base32,
        appSecret,
      ),
      backupCodes: [hashKeyedProtectedValue(backupCode, appSecret)],
      lastUsedTotpCounter: null,
    };
    const service = new MfaService(
      createSerializedMfaDb(row) as any,
      {} as any,
      {} as any,
      {} as any,
      { getAppSecret: () => appSecret } as any,
      {} as any,
      {} as any,
    );

    const results = await Promise.all([
      (service as any).consumeVerificationCode(
        'user-1',
        'workspace-1',
        backupCode,
      ),
      (service as any).consumeVerificationCode(
        'user-1',
        'workspace-1',
        backupCode,
      ),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(row.backupCodes).toEqual([]);
  });

  it('rejects a revoked access session during MFA access validation', async () => {
    const tokenService = {
      verifyJwt: jest.fn().mockResolvedValue({
        sub: 'user-1',
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
      }),
    };
    const sessionService = {
      isSessionActive: jest.fn().mockResolvedValue(false),
    };
    const service = new MfaService(
      {} as any,
      tokenService as any,
      sessionService as any,
      {} as any,
      { getAppSecret: () => appSecret } as any,
      {} as any,
      {} as any,
    );

    await expect(service.validateMfaAccess('access-token')).resolves.toEqual({
      valid: false,
    });
  });

  it('clears MFA assurance from every active session when MFA is disabled', async () => {
    const query: any = {
      where: jest.fn(() => query),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const assurance = {
      clearMfaForUser: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MfaService(
      { deleteFrom: jest.fn(() => query) } as any,
      {} as any,
      {} as any,
      {} as any,
      { getAppSecret: () => appSecret } as any,
      assurance as any,
      {} as any,
    );

    await expect(
      service.disable(
        { id: 'user-1', hasGeneratedPassword: true } as any,
        'workspace-1',
        {} as any,
      ),
    ).resolves.toEqual({ success: true });

    expect(assurance.clearMfaForUser).toHaveBeenCalledWith(
      'user-1',
      'workspace-1',
    );
  });
});
