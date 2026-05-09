import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { DictionaryTermRepo } from '@docmost/db/repos/dictionary/dictionary-term.repo';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import {
  CreateDictionaryTermDto,
  UpdateDictionaryTermDto,
} from './dto/dictionary-term.dto';
import { DictionaryTermResponse } from './dictionary-term.types';
import { User } from '@docmost/db/types/entity.types';

interface PreparedAlias {
  alias: string;
  normalizedAlias: string;
  isPrimary: boolean;
}

@Injectable()
export class DictionaryService {
  constructor(
    private readonly dictionaryTermRepo: DictionaryTermRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async listTerms(
    spaceId: string,
    workspaceId: string,
  ): Promise<DictionaryTermResponse[]> {
    const terms = await this.dictionaryTermRepo.listBySpace(
      spaceId,
      workspaceId,
    );

    return terms.map((term) => this.toResponse(term));
  }

  async createTerm(
    dto: CreateDictionaryTermDto,
    user: User,
    workspaceId: string,
  ): Promise<DictionaryTermResponse> {
    const aliases = this.prepareAliases(dto.term, dto.forms ?? []);
    await this.ensureAliasesAreAvailable(dto.spaceId, workspaceId, aliases);

    try {
      return await executeTx(this.db, async (trx) => {
        const term = await this.dictionaryTermRepo.insertTerm(
          {
            spaceId: dto.spaceId,
            workspaceId,
            creatorId: user.id,
            term: aliases[0].alias,
            definitionMarkdown: dto.definitionMarkdown.trim(),
          },
          trx,
        );

        const savedAliases = await this.insertAliases(
          term.id,
          dto.spaceId,
          workspaceId,
          aliases,
          trx,
        );

        return this.toResponse({ ...term, aliases: savedAliases });
      });
    } catch (err) {
      this.rethrowDuplicateAliasError(err);
      throw err;
    }
  }

  async getTermForPermission(termId: string, workspaceId: string) {
    const existingTerm = await this.dictionaryTermRepo.findById(
      termId,
      workspaceId,
    );

    if (!existingTerm) {
      throw new NotFoundException('Dictionary term not found');
    }

    return existingTerm;
  }

  async updateTerm(
    termId: string,
    dto: UpdateDictionaryTermDto,
    workspaceId: string,
  ): Promise<DictionaryTermResponse> {
    const existingTerm = await this.getTermForPermission(termId, workspaceId);

    const currentForms = existingTerm.aliases
      .filter((alias) => !alias.isPrimary)
      .map((alias) => alias.alias);
    const nextTerm = dto.term ?? existingTerm.term;
    const nextForms = dto.forms ?? currentForms;
    const aliases = this.prepareAliases(nextTerm, nextForms);

    await this.ensureAliasesAreAvailable(
      existingTerm.spaceId,
      workspaceId,
      aliases,
      { excludeTermId: termId },
    );

    try {
      return await executeTx(this.db, async (trx) => {
        const updatedTerm = await this.dictionaryTermRepo.updateTerm(
          termId,
          workspaceId,
          {
            term: aliases[0].alias,
            definitionMarkdown:
              dto.definitionMarkdown?.trim() ??
              existingTerm.definitionMarkdown,
          },
          trx,
        );

        if (!updatedTerm) {
          throw new NotFoundException('Dictionary term not found');
        }

        await this.dictionaryTermRepo.deleteAliasesByTermId(
          termId,
          workspaceId,
          trx,
        );

        const savedAliases = await this.insertAliases(
          termId,
          existingTerm.spaceId,
          workspaceId,
          aliases,
          trx,
        );

        return this.toResponse({ ...updatedTerm, aliases: savedAliases });
      });
    } catch (err) {
      this.rethrowDuplicateAliasError(err);
      throw err;
    }
  }

  async deleteTerm(termId: string, workspaceId: string): Promise<void> {
    const existingTerm = await this.getTermForPermission(termId, workspaceId);

    await executeTx(this.db, async (trx) => {
      await this.dictionaryTermRepo.deleteAliasesByTermId(
        termId,
        workspaceId,
        trx,
      );
      await this.dictionaryTermRepo.softDeleteTerm(termId, workspaceId, trx);
    });
  }

  private prepareAliases(term: string, forms: string[]): PreparedAlias[] {
    const primaryAlias = this.normalizeVisibleAlias(term);
    if (!primaryAlias) {
      throw new BadRequestException('Dictionary term is required');
    }

    const seen = new Set<string>();
    const aliases: PreparedAlias[] = [];

    const addAlias = (alias: string, isPrimary: boolean) => {
      const visibleAlias = this.normalizeVisibleAlias(alias);
      if (!visibleAlias) {
        return;
      }

      const normalizedAlias = this.normalizeLookupAlias(visibleAlias);
      if (seen.has(normalizedAlias)) {
        return;
      }

      seen.add(normalizedAlias);
      aliases.push({ alias: visibleAlias, normalizedAlias, isPrimary });
    };

    addAlias(primaryAlias, true);
    forms.forEach((form) => addAlias(form, false));

    return aliases;
  }

  private async ensureAliasesAreAvailable(
    spaceId: string,
    workspaceId: string,
    aliases: PreparedAlias[],
    opts?: { excludeTermId?: string },
  ) {
    const conflicts =
      await this.dictionaryTermRepo.findAliasesByNormalized(
        spaceId,
        workspaceId,
        aliases.map((alias) => alias.normalizedAlias),
        opts,
      );

    if (conflicts.length > 0) {
      throw new BadRequestException(
        'Dictionary term or form already exists in this space',
      );
    }
  }

  private insertAliases(
    termId: string,
    spaceId: string,
    workspaceId: string,
    aliases: PreparedAlias[],
    trx: KyselyTransaction,
  ) {
    return this.dictionaryTermRepo.insertAliases(
      aliases.map((alias) => ({
        termId,
        spaceId,
        workspaceId,
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias,
        isPrimary: alias.isPrimary,
      })),
      trx,
    );
  }

  private normalizeVisibleAlias(value: string): string {
    return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  }

  private normalizeLookupAlias(value: string): string {
    return this.normalizeVisibleAlias(value).toLocaleLowerCase();
  }

  private toResponse(term: {
    id: string;
    spaceId: string;
    workspaceId: string;
    term: string;
    definitionMarkdown: string;
    createdAt: Date;
    updatedAt: Date;
    aliases: Array<{ alias: string; isPrimary: boolean }>;
  }): DictionaryTermResponse {
    return {
      id: term.id,
      spaceId: term.spaceId,
      workspaceId: term.workspaceId,
      term: term.term,
      forms: term.aliases
        .filter((alias) => !alias.isPrimary)
        .map((alias) => alias.alias),
      definitionMarkdown: term.definitionMarkdown,
      createdAt: term.createdAt,
      updatedAt: term.updatedAt,
    };
  }

  private rethrowDuplicateAliasError(err: unknown): never | void {
    const error = err as {
      code?: string;
      cause?: { code?: string };
      driverError?: { code?: string };
    };
    const code =
      error.code ?? error.cause?.code ?? error.driverError?.code;

    if (code === '23505') {
      throw new BadRequestException(
        'Dictionary term or form already exists in this space',
      );
    }
  }
}
