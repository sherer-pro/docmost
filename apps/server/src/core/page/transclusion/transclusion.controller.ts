import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import { TransclusionService } from './transclusion.service';
import { LookupDto } from './dto/lookup.dto';
import { ReferencesDto } from './dto/references.dto';
import { UnsyncReferenceDto } from './dto/unsync-reference.dto';
import { AuthPolicyScope } from '../../../common/decorators/auth-policy-scope.decorator';
import { PageEmbedService } from './page-embed.service';

@UseGuards(JwtAuthGuard)
@Controller('pages/transclusion')
export class TransclusionController {
  constructor(
    private readonly transclusionService: TransclusionService,
    private readonly pageEmbedService: PageEmbedService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', {
    source: 'body',
    key: 'referencePageId',
    optional: true,
  })
  @Post('lookup')
  async lookup(@Body() dto: LookupDto, @AuthUser() user: User) {
    const blockReferences = dto.references
      .map((reference, index) => ({ reference, index }))
      .filter(({ reference }) => (reference.kind ?? 'block') === 'block');
    const pageReferences = dto.references
      .map((reference, index) => ({ reference, index }))
      .filter(({ reference }) => reference.kind === 'page');
    const [blockResult, pageResult] = await Promise.all([
      this.transclusionService.lookup(
        blockReferences.map(({ reference }) => ({
          sourcePageId: reference.sourcePageId,
          transclusionId: reference.transclusionId!,
        })),
        user,
      ),
      this.pageEmbedService.lookup(
        pageReferences.map(({ reference }) => reference.sourcePageId),
        user,
        dto.referencePageId,
      ),
    ]);
    const items = new Array(dto.references.length);
    blockReferences.forEach(({ index }, resultIndex) => {
      items[index] = blockResult.items[resultIndex];
    });
    pageReferences.forEach(({ index }, resultIndex) => {
      items[index] = pageResult.items[resultIndex];
    });
    return { items, maxDepth: this.pageEmbedService.getMaxDepth() };
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body', key: 'sourcePageId' })
  @Post('references')
  async references(@Body() dto: ReferencesDto, @AuthUser() user: User) {
    return this.transclusionService.listReferences({
      sourcePageId: dto.sourcePageId,
      transclusionId: dto.transclusionId,
      viewer: user,
    });
  }

  @HttpCode(HttpStatus.OK)
  @AuthPolicyScope('page', { source: 'body', key: 'referencePageId' })
  @Post('unsync-reference')
  async unsyncReference(
    @Body() dto: UnsyncReferenceDto,
    @AuthUser() user: User,
  ) {
    return this.transclusionService.unsyncReference(
      dto.referencePageId,
      dto.sourcePageId,
      dto.transclusionId,
      user,
    );
  }
}
