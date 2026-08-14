jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { TransclusionPersistenceModule } from '../core/page/transclusion/transclusion.module';
import { PageTemplatePolicyService } from '../core/page/transclusion/page-template-policy.service';
import { CollaborationRuntimeModule } from './collaboration.module';
import { PersistenceExtension } from './extensions/persistence.extension';

describe('Collaboration template provider graph', () => {
  it('provides the shared template policy guard to persistence', () => {
    const imports =
      Reflect.getMetadata(
        MODULE_METADATA.IMPORTS,
        CollaborationRuntimeModule,
      ) ?? [];
    const providers =
      Reflect.getMetadata(
        MODULE_METADATA.PROVIDERS,
        CollaborationRuntimeModule,
      ) ?? [];
    const persistenceExports =
      Reflect.getMetadata(
        MODULE_METADATA.EXPORTS,
        TransclusionPersistenceModule,
      ) ?? [];

    expect(imports).toContain(TransclusionPersistenceModule);
    expect(providers).toContain(PersistenceExtension);
    expect(persistenceExports).toContain(PageTemplatePolicyService);
  });
});
