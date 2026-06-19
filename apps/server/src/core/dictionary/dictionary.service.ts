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
  DictionaryImportTermDto,
  UpdateDictionaryTermDto,
} from './dto/dictionary-term.dto';
import {
  DictionaryExportResponse,
  DictionaryImportResult,
  DictionaryTermResponse,
} from './dictionary-term.types';
import { User } from '@docmost/db/types/entity.types';

interface PreparedAlias {
  alias: string;
  normalizedAlias: string;
  isPrimary: boolean;
}

interface PreparedImportTerm {
  source: DictionaryImportTermDto;
  aliases: PreparedAlias[];
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

  async exportTerms(
    spaceId: string,
    workspaceId: string,
  ): Promise<DictionaryExportResponse> {
    await this.ensureSpaceBelongsToWorkspace(spaceId, workspaceId);

    const terms = await this.listTerms(spaceId, workspaceId);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      terms: terms.map((term) => ({
        term: term.term,
        forms: term.forms,
        definitionMarkdown: term.definitionMarkdown,
      })),
    };
  }

  async importTerms(
    spaceId: string,
    terms: DictionaryImportTermDto[],
    user: User,
    workspaceId: string,
  ): Promise<DictionaryImportResult> {
    await this.ensureSpaceBelongsToWorkspace(spaceId, workspaceId);

    const preparedTerms = terms.map((term) => ({
      source: term,
      aliases: this.prepareAliases(term.term, term.forms ?? [], {
        rejectDuplicates: true,
      }),
    }));

    const importedAliasesByNormalized = new Map<
      string,
      { importTerm: PreparedImportTerm; alias: PreparedAlias }
    >();

    for (const importTerm of preparedTerms) {
      for (const alias of importTerm.aliases) {
        if (importedAliasesByNormalized.has(alias.normalizedAlias)) {
          throw new BadRequestException(
            'Duplicate dictionary term or form in import file',
          );
        }

        importedAliasesByNormalized.set(alias.normalizedAlias, {
          importTerm,
          alias,
        });
      }
    }

    const importedNormalizedAliases = Array.from(
      importedAliasesByNormalized.keys(),
    );
    const existingAliases =
      await this.dictionaryTermRepo.findAliasesByNormalized(
        spaceId,
        workspaceId,
        importedNormalizedAliases,
      );
    const existingPrimaryTermsByNormalized = new Map<string, string>();

    for (const alias of existingAliases) {
      if (alias.isPrimary) {
        existingPrimaryTermsByNormalized.set(
          alias.normalizedAlias,
          alias.termId,
        );
      }
    }

    for (const alias of existingAliases) {
      const importedAlias = importedAliasesByNormalized.get(
        alias.normalizedAlias,
      );

      if (!importedAlias) {
        continue;
      }

      const importedPrimaryAlias =
        importedAlias.importTerm.aliases[0].normalizedAlias;
      const matchedTermId = existingPrimaryTermsByNormalized.get(
        importedPrimaryAlias,
      );

      if (alias.termId !== matchedTermId) {
        throw new BadRequestException(
          'Dictionary term or form already exists in this space',
        );
      }
    }

    try {
      return await executeTx(this.db, async (trx) => {
        let created = 0;
        let updated = 0;

        for (const importTerm of preparedTerms) {
          const primaryAlias = importTerm.aliases[0];
          const existingTermId = existingPrimaryTermsByNormalized.get(
            primaryAlias.normalizedAlias,
          );

          if (existingTermId) {
            const updatedTerm = await this.dictionaryTermRepo.updateTerm(
              existingTermId,
              workspaceId,
              {
                term: primaryAlias.alias,
                definitionMarkdown:
                  importTerm.source.definitionMarkdown.trim(),
              },
              trx,
            );

            if (!updatedTerm) {
              throw new NotFoundException('Dictionary term not found');
            }

            await this.dictionaryTermRepo.deleteAliasesByTermId(
              existingTermId,
              workspaceId,
              trx,
            );
            await this.insertAliases(
              existingTermId,
              spaceId,
              workspaceId,
              importTerm.aliases,
              trx,
            );
            updated += 1;
            continue;
          }

          const term = await this.dictionaryTermRepo.insertTerm(
            {
              spaceId,
              workspaceId,
              creatorId: user.id,
              term: primaryAlias.alias,
              definitionMarkdown:
                importTerm.source.definitionMarkdown.trim(),
            },
            trx,
          );

          await this.insertAliases(
            term.id,
            spaceId,
            workspaceId,
            importTerm.aliases,
            trx,
          );
          created += 1;
        }

        return {
          created,
          updated,
          total: preparedTerms.length,
        };
      });
    } catch (err) {
      this.rethrowDuplicateAliasError(err);
      throw err;
    }
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

  private prepareAliases(
    term: string,
    forms: string[],
    opts?: { rejectDuplicates?: boolean },
  ): PreparedAlias[] {
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
        if (opts?.rejectDuplicates) {
          throw new BadRequestException(
            'Duplicate dictionary term or form in import file',
          );
        }

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

  private async ensureSpaceBelongsToWorkspace(
    spaceId: string,
    workspaceId: string,
  ): Promise<void> {
    const space = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!space) {
      throw new NotFoundException('Space not found');
    }
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
