import { RagSyncBindingRegistryService } from './rag-sync-binding-registry.service';

describe('RagSyncBindingRegistryService', () => {
  const validBinding = {
    id: 'binding-1',
    workspaceId: 'workspace-1',
    spaceId: 'space-1',
    state: 'enabled',
    adapter: 'open-webui-knowledge-v1',
    baseUrl: 'https://open-webui.example',
    knowledgeId: 'knowledge-1',
    writerApiKeyEncrypted: 'encrypted-writer-key',
    configVersion: 3,
    targetVersion: 2,
    targetClaimId: 'claim-1',
    updatedAt: new Date(123),
  } as any;

  it('keeps credentials out of complete runtime bindings and skips incomplete rows', async () => {
    const repo = {
      listRunnableBindings: jest
        .fn()
        .mockResolvedValue([
          validBinding,
          { ...validBinding, id: 'binding-incomplete', baseUrl: null },
        ]),
      hasActiveClaim: jest.fn().mockResolvedValue(true),
    };
    const service = new RagSyncBindingRegistryService(repo as any);

    const bindings = await service.listRunnableBindings();
    expect(bindings).toEqual([
      expect.objectContaining({
        id: validBinding.id,
        targetVersion: 2,
        updatedAtMs: 123,
      }),
    ]);
    expect(bindings[0]).not.toHaveProperty('writerApiKey');
  });

  it('skips a runnable row whose target claim is not active and exact', async () => {
    const repo = {
      listRunnableBindings: jest.fn().mockResolvedValue([validBinding]),
      hasActiveClaim: jest.fn().mockResolvedValue(false),
    };
    const service = new RagSyncBindingRegistryService(repo as any);

    await expect(service.listRunnableBindings()).resolves.toEqual([]);
  });

  it('completes a drain using config- and target-version fencing', async () => {
    const repo = {
      listRunnableBindings: jest.fn(),
      completeCleanup: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RagSyncBindingRegistryService(repo as any);

    await service.completeDrain('binding-1', 6, 7);

    expect(repo.completeCleanup).toHaveBeenCalledWith('binding-1', 6, 7);
  });

  it('stops a failed binding using config- and target-version fencing', async () => {
    const repo = {
      stopForRuntimeError: jest.fn().mockResolvedValue(true),
    };
    const service = new RagSyncBindingRegistryService(repo as any);

    await expect(
      service.stopForRuntimeError('binding-1', 6, 7, true),
    ).resolves.toBe(true);

    expect(repo.stopForRuntimeError).toHaveBeenCalledWith(
      'binding-1',
      6,
      7,
      true,
    );
  });
});
