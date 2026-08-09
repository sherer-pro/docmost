import { MODULE_METADATA } from '@nestjs/common/constants';
import { DatabaseModule } from './database.module';
import { DatabaseReadinessService } from './services/database-readiness.service';

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

  it('completes production migrations before marking the database ready', async () => {
    const calls: string[] = [];
    const module = new DatabaseModule(
      {} as never,
      {
        migrateToLatest: jest.fn(async () => {
          calls.push('migrate');
        }),
      } as never,
      { getNodeEnv: jest.fn(() => 'production') } as never,
      {
        markReady: jest.fn(() => {
          calls.push('ready');
        }),
      } as never,
    );
    jest.spyOn(module, 'establishConnection').mockImplementation(async () => {
      calls.push('connect');
    });

    await module.onModuleInit();

    expect(calls).toEqual(['connect', 'migrate', 'ready']);
  });
});
