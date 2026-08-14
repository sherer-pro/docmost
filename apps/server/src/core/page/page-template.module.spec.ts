jest.mock('lib0/decoding.js', () => ({ readVarString: jest.fn() }));

import { MODULE_METADATA } from '@nestjs/common/constants';
import { PageModule } from './page.module';
import { PageService } from './services/page.service';
import { PageTemplateInstanceService } from './services/page-template-instance.service';
import { PageTemplateService } from './services/page-template.service';
import { PageTemplateSyncService } from './services/page-template-sync.service';
import { PageTemplatePolicyService } from './transclusion/page-template-policy.service';
import { TransclusionModule } from './transclusion/transclusion.module';

describe('Page template provider graph', () => {
  it('wires the HTTP facade to the template services and policy provider', () => {
    const imports =
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, PageModule) ?? [];
    const providers =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PageModule) ?? [];
    const transclusionExports =
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, TransclusionModule) ?? [];

    expect(imports).toContain(TransclusionModule);
    expect(providers).toEqual(
      expect.arrayContaining([
        PageService,
        PageTemplateService,
        PageTemplateInstanceService,
        PageTemplateSyncService,
      ]),
    );
    expect(transclusionExports).toContain(PageTemplatePolicyService);
  });
});
