import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  decryptProtectedValue,
  encryptProtectedValue,
} from '../../../common/security/credential-protection.util';
import { RagSyncOperationLockError } from './rag-sync-admin.ports';
import { RagSyncAdminService } from './rag-sync-admin.service';

describe('RagSyncAdminService', () => {
  const user = { id: 'user-1', workspaceId: 'workspace-1' } as any;
  const workspace = { id: 'workspace-1' } as any;
  const baseBinding = {
    id: 'binding-1',
    workspaceId: workspace.id,
    spaceId: 'space-1',
    state: 'disabled',
    adapter: 'open-webui-knowledge-v1',
    baseUrl: 'https://open-webui.example',
    knowledgeId: 'knowledge-1',
    writerApiKeyEncrypted: 'enc:v1:test',
    lastTestedAt: new Date('2026-08-11T12:00:00.000Z'),
    configVersion: 3,
    targetVersion: 1,
    targetClaimId: 'claim-1',
    cleanupRequired: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: user.id,
    updatedById: user.id,
  } as any;

  function setup(options?: { enabled?: boolean; binding?: any; writer?: any }) {
    const binding = options?.binding ?? baseBinding;
    const repo = {
      spaceExists: jest.fn().mockResolvedValue(true),
      findBySpace: jest.fn().mockResolvedValue(binding),
      withSpaceLock: jest.fn(async (_workspaceId, _spaceId, callback) =>
        callback({}),
      ),
      insertBinding: jest.fn(),
      updateBinding: jest.fn(async (_id, values) => ({
        ...binding,
        ...values,
        updatedAt: new Date(),
      })),
      findClaimByFingerprint: jest.fn(),
      findClaimById: jest.fn().mockResolvedValue({
        id: 'claim-1',
        workspaceId: workspace.id,
        spaceId: 'space-1',
        bindingId: 'binding-1',
        targetFingerprint: fingerprint(
          'https://open-webui.example',
          'knowledge-1',
        ),
        state: 'active',
      }),
      insertClaim: jest.fn().mockResolvedValue({ id: 'claim-new' }),
      activateClaim: jest.fn(),
      deleteClaim: jest.fn().mockResolvedValue(true),
      orphanClaim: jest.fn(),
      completeTargetTest: jest.fn(async (_id, expectedConfigVersion) => ({
        ...binding,
        cleanupRequired: false,
        configVersion: expectedConfigVersion + 1,
        lastTestedAt: new Date('2026-08-11T12:01:00.000Z'),
        updatedAt: new Date(),
      })),
    };
    const ability = { assertHasFullSpaceAccess: jest.fn() };
    const environment = { getAppSecret: () => 'test-app-secret' };
    const config = {
      get: jest.fn(() => (options?.enabled === false ? 'false' : 'true')),
    };
    const operationLock = {
      runExclusive: jest.fn(async (_workspaceId, _spaceId, callback) =>
        callback(new AbortController().signal),
      ),
    };
    const writer = options?.writer ?? {
      testTarget: jest.fn().mockResolvedValue({ ok: true, latencyMs: 12 }),
    };
    const control = { bindingChanged: jest.fn() };
    const service = new RagSyncAdminService(
      repo as any,
      ability as any,
      environment as any,
      config as any,
      operationLock as any,
      writer,
      undefined,
      control,
    );
    return { service, repo, ability, operationLock, writer, control };
  }

  it('returns a redacted per-space configuration', async () => {
    const { service } = setup();

    const result = await service.getConfig('space-1', user, workspace);

    expect(result.target).toEqual({
      adapter: 'open-webui-knowledge-v1',
      baseUrl: 'https://open-webui.example',
      knowledgeId: 'knowledge-1',
      writerApiKeyConfigured: true,
      lastTestedAt: '2026-08-11T12:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('enc:v1:test');
  });

  it('encrypts a new writer key and never stores the plaintext', async () => {
    const existing = { ...baseBinding, writerApiKeyEncrypted: null };
    const { service, repo } = setup({ binding: existing });
    repo.findBySpace.mockResolvedValue(existing);

    await service.updateConfig(
      'space-1',
      {
        expectedVersion: 3,
        target: { writerApiKey: 'writer-secret' },
      },
      user,
      workspace,
    );

    const values =
      repo.updateBinding.mock.calls[
        repo.updateBinding.mock.calls.length - 1
      ][1];
    expect(values.writerApiKeyEncrypted).not.toBe('writer-secret');
    expect(
      decryptProtectedValue(values.writerApiKeyEncrypted, 'test-app-secret'),
    ).toBe('writer-secret');
  });

  it('clears the old writer key when the target changes without a replacement key', async () => {
    const { service, repo } = setup();

    const result = await service.updateConfig(
      'space-1',
      {
        expectedVersion: 3,
        target: { baseUrl: 'https://other-open-webui.example' },
      },
      user,
      workspace,
    );

    expect(repo.updateBinding).toHaveBeenLastCalledWith(
      baseBinding.id,
      expect.objectContaining({
        baseUrl: 'https://other-open-webui.example',
        writerApiKeyEncrypted: null,
      }),
      expect.anything(),
    );
    expect(result.target.writerApiKeyConfigured).toBe(false);
    expect(repo.insertClaim).not.toHaveBeenCalled();
    expect(repo.updateBinding).toHaveBeenLastCalledWith(
      baseBinding.id,
      expect.objectContaining({ targetClaimId: null }),
      expect.anything(),
    );
  });

  it('releases a clean target claim when its writer key is cleared', async () => {
    const { service, repo } = setup();

    await service.updateConfig(
      'space-1',
      {
        expectedVersion: baseBinding.configVersion,
        target: { clearWriterApiKey: true },
      },
      user,
      workspace,
    );

    expect(repo.deleteClaim).toHaveBeenCalledWith(
      baseBinding.targetClaimId,
      baseBinding,
      expect.anything(),
    );
    expect(repo.updateBinding).toHaveBeenLastCalledWith(
      baseBinding.id,
      expect.objectContaining({
        writerApiKeyEncrypted: null,
        targetClaimId: null,
      }),
      expect.anything(),
    );
  });

  it('canonicalizes a trailing DNS dot before comparing and claiming a target', async () => {
    const { service, repo } = setup();

    await service.updateConfig(
      'space-1',
      {
        expectedVersion: 3,
        target: { baseUrl: 'https://open-webui.example.' },
      },
      user,
      workspace,
    );

    expect(repo.updateBinding).toHaveBeenLastCalledWith(
      baseBinding.id,
      expect.objectContaining({
        baseUrl: 'https://open-webui.example',
        writerApiKeyEncrypted: baseBinding.writerApiKeyEncrypted,
      }),
      expect.anything(),
    );
  });

  it('rejects an outdated optimistic version', async () => {
    const { service } = setup();

    await expect(
      service.updateConfig(
        'space-1',
        { expectedVersion: 2, target: {} },
        user,
        workspace,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_config_conflict' }),
    });
  });

  it('moves an enabled binding to draining before cleanup', async () => {
    const binding = { ...baseBinding, state: 'enabled' };
    const { service, repo, control } = setup({ binding });

    const result = await service.disable(
      'space-1',
      { expectedVersion: 3 },
      user,
      workspace,
    );

    expect(repo.updateBinding).toHaveBeenCalledWith(
      binding.id,
      expect.objectContaining({
        state: 'draining',
        cleanupRequired: true,
        configVersion: 4,
      }),
      expect.anything(),
    );
    expect(result.state).toBe('draining');
    expect(control.bindingChanged).toHaveBeenCalledWith(binding.id);
  });

  it('enables a complete clean binding and advances its version', async () => {
    const { service, repo } = setup();

    const result = await service.enable(
      'space-1',
      { expectedVersion: 3 },
      user,
      workspace,
    );

    expect(repo.updateBinding).toHaveBeenCalledWith(
      baseBinding.id,
      expect.objectContaining({ state: 'enabled', configVersion: 4 }),
      expect.anything(),
    );
    expect(result.state).toBe('enabled');
  });

  it('rejects enabling a target that has not passed a successful test', async () => {
    const { service } = setup({
      binding: { ...baseBinding, lastTestedAt: null },
    });

    await expect(
      service.enable(
        'space-1',
        { expectedVersion: baseBinding.configVersion },
        user,
        workspace,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_target_not_tested' }),
    });
  });

  it('resumes cleanup only while the deployment runtime is enabled', async () => {
    const binding = {
      ...baseBinding,
      state: 'disabled',
      cleanupRequired: true,
    };
    const disabled = setup({ binding, enabled: false });

    await expect(
      disabled.service.retryCleanup(
        'space-1',
        { expectedVersion: 3 },
        user,
        workspace,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'rag_sync_deployment_disabled',
      }),
    });

    const enabled = setup({ binding });
    await expect(
      enabled.service.retryCleanup(
        'space-1',
        { expectedVersion: 3 },
        user,
        workspace,
      ),
    ).resolves.toMatchObject({ state: 'draining', cleanupRequired: true });
  });

  it('rotates the writer key while enabled but cannot clear it there', async () => {
    const binding = { ...baseBinding, state: 'enabled' };
    const { service, repo } = setup({ binding });

    await service.updateConfig(
      'space-1',
      {
        expectedVersion: 3,
        target: { writerApiKey: 'rotated-writer-secret' },
      },
      user,
      workspace,
    );
    const stored =
      repo.updateBinding.mock.calls.at(-1)?.[1].writerApiKeyEncrypted;
    expect(decryptProtectedValue(stored, 'test-app-secret')).toBe(
      'rotated-writer-secret',
    );
    expect(repo.updateBinding).toHaveBeenLastCalledWith(
      binding.id,
      expect.objectContaining({ lastTestedAt: null }),
      expect.anything(),
    );

    await expect(
      service.updateConfig(
        'space-1',
        {
          expectedVersion: 3,
          target: { clearWriterApiKey: true },
        },
        user,
        workspace,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_invalid_state' }),
    });
  });

  it('requires the deployment switch and a real writer for target tests', async () => {
    const disabled = setup({ enabled: false });
    await expect(
      disabled.service.testTarget('space-1', user, workspace),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    const missingWriter = setup();
    const service = new RagSyncAdminService(
      missingWriter.repo as any,
      missingWriter.ability as any,
      { getAppSecret: () => 'test-app-secret' } as any,
      { get: () => 'true' } as any,
      missingWriter.operationLock as any,
      undefined,
      undefined,
      undefined,
    );
    await expect(
      service.testTarget('space-1', user, workspace),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('passes only binding metadata to the injected target test port', async () => {
    const binding = {
      ...baseBinding,
      writerApiKeyEncrypted: encryptProtectedValue(
        'writer-secret',
        'test-app-secret',
      ),
    };
    const { service, repo, operationLock, writer } = setup({ binding });

    await expect(
      service.testTarget('space-1', user, workspace),
    ).resolves.toEqual({ ok: true, latencyMs: 12 });
    expect(writer.testTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: binding.id,
        workspaceId: binding.workspaceId,
        spaceId: binding.spaceId,
        configVersion: binding.configVersion + 1,
      }),
      expect.anything(),
    );
    expect(writer.testTarget.mock.calls[0][0]).not.toHaveProperty(
      'writerApiKey',
    );
    expect(operationLock.runExclusive).toHaveBeenCalledWith(
      workspace.id,
      binding.spaceId,
      expect.any(Function),
      { reserveGlobalSlot: true },
    );
    expect(repo.updateBinding).toHaveBeenCalledWith(
      binding.id,
      expect.objectContaining({
        cleanupRequired: true,
        lastTestedAt: null,
        configVersion: binding.configVersion + 1,
      }),
      expect.anything(),
    );
    expect(repo.completeTargetTest).toHaveBeenCalledWith(
      binding.id,
      binding.configVersion + 1,
      binding.targetVersion,
      expect.anything(),
    );
  });

  it('keeps durable cleanup state when a target test fails after upload may have started', async () => {
    const writer = {
      testTarget: jest.fn().mockRejectedValue(
        Object.assign(new Error('timeout'), {
          code: 'rag_sync_target_unavailable',
        }),
      ),
    };
    const { service, repo, control } = setup({ writer });

    await expect(
      service.testTarget('space-1', user, workspace),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'rag_sync_target_unavailable',
      }),
    });

    expect(repo.updateBinding).toHaveBeenCalledWith(
      baseBinding.id,
      expect.objectContaining({ cleanupRequired: true }),
      expect.anything(),
    );
    expect(repo.completeTargetTest).not.toHaveBeenCalled();
    expect(control.bindingChanged).toHaveBeenCalledWith(baseBinding.id);
  });

  it('maps an occupied operation lock to a stable conflict response', async () => {
    const { service, operationLock } = setup();
    operationLock.runExclusive.mockRejectedValue(
      new RagSyncOperationLockError('busy'),
    );

    await expect(
      service.updateConfig(
        'space-1',
        { expectedVersion: 3, target: {} },
        user,
        workspace,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_config_conflict' }),
    });
  });

  it('rejects target tests while cleanup is pending or the active claim is missing', async () => {
    const cleaning = setup({
      binding: { ...baseBinding, cleanupRequired: true },
    });
    await expect(
      cleaning.service.testTarget('space-1', user, workspace),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'rag_sync_cleanup_in_progress',
      }),
    });
    expect(cleaning.writer.testTarget).not.toHaveBeenCalled();

    const unclaimed = setup();
    unclaimed.repo.findClaimById.mockResolvedValue(undefined);
    await expect(
      unclaimed.service.testTarget('space-1', user, workspace),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_target_in_use' }),
    });
    expect(unclaimed.writer.testTarget).not.toHaveBeenCalled();
  });

  it('rejects force-disable for a clean disabled binding', async () => {
    const { service, repo } = setup();

    await expect(
      service.forceDisable(
        'space-1',
        { expectedVersion: 3, confirm: true },
        user,
        workspace,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_invalid_state' }),
    });
    expect(repo.updateBinding).not.toHaveBeenCalled();
  });

  it('does not turn a dirty disabled binding into draining through disable', async () => {
    const binding = { ...baseBinding, cleanupRequired: true };
    const { service, repo } = setup({ binding });

    await expect(
      service.disable(
        'space-1',
        { expectedVersion: binding.configVersion },
        user,
        workspace,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_cleanup_required' }),
    });
    expect(repo.updateBinding).not.toHaveBeenCalled();
  });

  it('reattaches its own orphaned target in cleanup-required state', async () => {
    const binding = {
      ...baseBinding,
      baseUrl: null,
      knowledgeId: null,
      writerApiKeyEncrypted: null,
      targetClaimId: null,
    };
    const { service, repo } = setup({ binding });
    repo.findClaimByFingerprint.mockResolvedValue({
      id: 'orphaned-claim',
      workspaceId: workspace.id,
      spaceId: binding.spaceId,
      bindingId: binding.id,
      state: 'orphaned',
    });

    const result = await service.updateConfig(
      'space-1',
      {
        expectedVersion: 3,
        target: {
          baseUrl: 'https://open-webui.example',
          knowledgeId: 'knowledge-1',
          writerApiKey: 'writer-secret',
        },
      },
      user,
      workspace,
    );

    expect(repo.activateClaim).toHaveBeenCalledWith(
      'orphaned-claim',
      expect.anything(),
    );
    expect(repo.updateBinding).toHaveBeenLastCalledWith(
      binding.id,
      expect.objectContaining({
        targetClaimId: 'orphaned-claim',
        cleanupRequired: true,
      }),
      expect.anything(),
    );
    expect(result.cleanupRequired).toBe(true);
  });

  it('rejects a target claimed by another space', async () => {
    const binding = { ...baseBinding, targetClaimId: null };
    const { service, repo } = setup({ binding });
    repo.findClaimByFingerprint.mockResolvedValue({
      id: 'claim-other',
      workspaceId: workspace.id,
      spaceId: 'space-other',
      bindingId: 'binding-other',
      state: 'active',
    });

    await expect(
      service.enable('space-1', { expectedVersion: 3 }, user, workspace),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'rag_sync_target_in_use' }),
    });
  });

  it('keeps an abandoned target claimed and clears its credential', async () => {
    const binding = {
      ...baseBinding,
      state: 'disabled',
      cleanupRequired: true,
    };
    const { service, repo } = setup({ binding });

    const result = await service.abandonCleanup(
      'space-1',
      { expectedVersion: 3, confirm: true },
      user,
      workspace,
    );

    expect(repo.orphanClaim).toHaveBeenCalledWith(
      binding.targetClaimId,
      expect.anything(),
    );
    expect(repo.updateBinding).toHaveBeenCalledWith(
      binding.id,
      expect.objectContaining({
        baseUrl: null,
        knowledgeId: null,
        writerApiKeyEncrypted: null,
        targetClaimId: null,
        cleanupRequired: false,
      }),
      expect.anything(),
    );
    expect(result.target.writerApiKeyConfigured).toBe(false);
  });

  it('rejects target changes while cleanup is required', async () => {
    const binding = { ...baseBinding, cleanupRequired: true };
    const { service } = setup({ binding });

    await expect(
      service.updateConfig(
        'space-1',
        {
          expectedVersion: 3,
          target: { knowledgeId: 'knowledge-2' },
        },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function fingerprint(baseUrl: string, knowledgeId: string): string {
  return createHash('sha256')
    .update(`${baseUrl}\n${knowledgeId}`, 'utf8')
    .digest('hex');
}
