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
});
