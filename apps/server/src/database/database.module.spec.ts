import { MODULE_METADATA } from '@nestjs/common/constants';
import { DatabaseModule } from './database.module';
import { DatabaseReadinessService } from './services/database-readiness.service';
import { GroupPersistenceModule } from './persistence/group-persistence.module';
import { LabelPersistenceModule } from './persistence/label-persistence.module';
import { ApiKeyPersistenceModule } from './persistence/api-key-persistence.module';
import { QueueOutboxPersistenceModule } from './persistence/queue-outbox-persistence.module';
import { GroupRepo } from './repos/group/group.repo';
import { GroupUserRepo } from './repos/group/group-user.repo';
import { LabelRepo } from './repos/label/label.repo';
import { ApiKeyRepo } from './repos/api-key/api-key.repo';
import { QueueOutboxRepo } from './repos/queue-outbox/queue-outbox.repo';

describe('DatabaseModule', () => {
  it('exports the singleton database readiness barrier', () => {
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DatabaseModule) ?? [];
    const exports =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, DatabaseModule) ?? [];

    expect(
      providers.filter(
        (provider: unknown) => provider === DatabaseReadinessService,
      ),
    ).toHaveLength(1);
    expect(exports).toContain(DatabaseReadinessService);
  });

  it('owns touched repositories in one narrow persistence module each', () => {
    const imports =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, DatabaseModule) ?? [];
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DatabaseModule) ?? [];

    expect(imports).toEqual(
      expect.arrayContaining([
        GroupPersistenceModule,
        LabelPersistenceModule,
        ApiKeyPersistenceModule,
        QueueOutboxPersistenceModule,
      ]),
    );
    expect(providers).not.toEqual(
      expect.arrayContaining([
        GroupRepo,
        GroupUserRepo,
        LabelRepo,
        ApiKeyRepo,
        QueueOutboxRepo,
      ]),
    );
  });

  it('completes production migrations before marking the database ready', async () => {
    const calls: string[] = [];
    const module = new DatabaseModule(
      {} as never,
      {
        migrateToLatest: jest.fn(async () => {
          calls.push('migrate');
        }),
      } as never,
      {
        getNodeEnv: jest.fn(() => 'production'),
        getDatabaseMigrationMode: jest.fn(() => 'auto'),
      } as never,
      {
        markReady: jest.fn(() => {
          calls.push('ready');
        }),
      } as never,
      {
        assertSafe: jest.fn(async ({ requireLatest }) => {
          calls.push(requireLatest ? 'preflight-latest' : 'preflight');
        }),
      } as never,
    );
    jest.spyOn(module, 'establishConnection').mockImplementation(async () => {
      calls.push('connect');
    });

    await module.onModuleInit();

    expect(calls).toEqual([
      'connect',
      'preflight',
      'migrate',
      'preflight-latest',
      'ready',
    ]);
  });

  it('requires current migrations without mutating schema in external mode', async () => {
    const migrateToLatest = jest.fn();
    const assertSafe = jest.fn(async () => undefined);
    const markReady = jest.fn();
    const module = new DatabaseModule(
      {} as never,
      { migrateToLatest } as never,
      {
        getNodeEnv: jest.fn(() => 'production'),
        getDatabaseMigrationMode: jest.fn(() => 'external'),
      } as never,
      { markReady } as never,
      { assertSafe } as never,
    );
    jest.spyOn(module, 'establishConnection').mockResolvedValue();

    await module.onModuleInit();

    expect(migrateToLatest).not.toHaveBeenCalled();
    expect(assertSafe).toHaveBeenNthCalledWith(1, { requireLatest: false });
    expect(assertSafe).toHaveBeenNthCalledWith(2, { requireLatest: true });
    expect(markReady).toHaveBeenCalledTimes(1);
  });
});
