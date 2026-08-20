import { Client } from 'typesense';
import type { Queue } from 'bullmq';
import type { KyselyDB } from '../src/database/types/kysely.types';
import type { EnvironmentService } from '../src/integrations/environment/environment.service';
import {
  TYPESENSE_ATTACHMENT_ALIAS,
  TYPESENSE_ATTACHMENT_COLLECTION,
  TYPESENSE_DICTIONARY_ALIAS,
  TYPESENSE_DICTIONARY_COLLECTION,
  TYPESENSE_PAGE_ALIAS,
  TYPESENSE_PAGE_COLLECTION,
  TypesenseIndexService,
  type TypesenseDictionaryDocument,
  type TypesensePageDocument,
} from '../src/core/search/typesense-index.service';

const liveTypesenseEnabled = process.env.TYPESENSE_E2E_ISOLATED === 'true';
const describeLive = liveTypesenseEnabled ? describe : describe.skip;

describeLive('Typesense search generations (e2e)', () => {
  const url = process.env.TYPESENSE_URL!;
  const apiKey = process.env.TYPESENSE_API_KEY!;
  const legacyPageCollection = 'docmost_pages_v2';
  let client: Client;
  let service: TypesenseIndexService;

  beforeAll(async () => {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/u.test(url)) {
      throw new Error('Typesense E2E requires a dedicated loopback instance');
    }
    client = new Client({
      nodes: [{ url }],
      apiKey,
      connectionTimeoutSeconds: 5,
    });
    await cleanup();

    const environment = {
      getSearchDriver: () => 'typesense',
      getTypesenseUrl: () => url,
      getTypesenseApiKey: () => apiKey,
      getTypesenseLocale: () => 'en',
    } as EnvironmentService;
    service = new TypesenseIndexService(
      environment,
      {} as KyselyDB,
      { add: jest.fn() } as unknown as Queue,
    );
    await (
      service as unknown as { ensureCollections(): Promise<void> }
    ).ensureCollections();
    await Promise.all([
      client.aliases().upsert(TYPESENSE_PAGE_ALIAS, {
        collection_name: TYPESENSE_PAGE_COLLECTION,
      }),
      client.aliases().upsert(TYPESENSE_ATTACHMENT_ALIAS, {
        collection_name: TYPESENSE_ATTACHMENT_COLLECTION,
      }),
      client.aliases().upsert(TYPESENSE_DICTIONARY_ALIAS, {
        collection_name: TYPESENSE_DICTIONARY_COLLECTION,
      }),
    ]);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('creates the production schemas and accepts their weighted queries', async () => {
    const [pageSchema, dictionarySchema] = await Promise.all([
      client.collections(TYPESENSE_PAGE_COLLECTION).retrieve(),
      client.collections(TYPESENSE_DICTIONARY_COLLECTION).retrieve(),
    ]);
    expect(pageSchema.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['title', 'content', 'databaseContent']),
    );
    expect(dictionarySchema.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['term', 'forms', 'definitionText']),
    );

    await client
      .collections<TypesensePageDocument>(TYPESENSE_PAGE_COLLECTION)
      .documents()
      .create({
        id: 'page-database-row',
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        creatorId: 'user-1',
        title: 'Row title',
        content: '',
        databaseContent: 'Quarterly alpha projection',
        updatedAt: 1,
      });
    const pageResult = await service.searchPages({
      q: 'alpha',
      query_by: 'title,content,databaseContent',
      query_by_weights: '8,3,2',
      filter_by: 'workspaceId:=`workspace-1`',
    });
    expect(pageResult.hits?.map((hit) => hit.document.id)).toContain(
      'page-database-row',
    );

    await client
      .collections<TypesenseDictionaryDocument>(TYPESENSE_DICTIONARY_COLLECTION)
      .documents()
      .import(
        [
          {
            id: 'term-primary',
            workspaceId: 'workspace-1',
            spaceId: 'space-1',
            term: 'Protocol',
            forms: ['Protocols'],
            definitionText: 'A documented agreement',
            updatedAt: 2,
          },
          {
            id: 'term-definition-only',
            workspaceId: 'workspace-1',
            spaceId: 'space-1',
            term: 'Agreement',
            forms: [],
            definitionText: 'Reconcilliation guidance',
            updatedAt: 1,
          },
        ],
        { action: 'upsert', throwOnFail: true },
      );
    const dictionaryResult = await service.searchDictionary({
      q: 'Protcol',
      query_by: 'term,forms,definitionText',
      query_by_weights: '8,6,1',
      num_typos: '2,2,0',
      prefix: 'true,true,false',
      filter_by: 'workspaceId:=`workspace-1`',
    });
    expect(dictionaryResult.hits?.map((hit) => hit.document.id)).toContain(
      'term-primary',
    );
    const definitionTypoResult = await service.searchDictionary({
      q: 'reconciliation',
      query_by: 'term,forms,definitionText',
      query_by_weights: '8,6,1',
      num_typos: '2,2,0',
      prefix: 'true,true,false',
      filter_by: 'workspaceId:=`workspace-1`',
    });
    expect(
      definitionTypoResult.hits?.map((hit) => hit.document.id),
    ).not.toContain('term-definition-only');
  });

  it('supports alias switch, rollback, and stale-document removal', async () => {
    const pageSchema = await client
      .collections(TYPESENSE_PAGE_COLLECTION)
      .retrieve();
    await client.collections().create({
      ...pageSchema,
      name: legacyPageCollection,
      num_documents: undefined,
      created_at: undefined,
    });

    await client.aliases().upsert(TYPESENSE_PAGE_ALIAS, {
      collection_name: legacyPageCollection,
    });
    expect(
      (await client.aliases(TYPESENSE_PAGE_ALIAS).retrieve()).collection_name,
    ).toBe(legacyPageCollection);
    await client.aliases().upsert(TYPESENSE_PAGE_ALIAS, {
      collection_name: TYPESENSE_PAGE_COLLECTION,
    });
    expect(
      (await client.aliases(TYPESENSE_PAGE_ALIAS).retrieve()).collection_name,
    ).toBe(TYPESENSE_PAGE_COLLECTION);
    await client.aliases().upsert(TYPESENSE_PAGE_ALIAS, {
      collection_name: legacyPageCollection,
    });
    expect(
      (await client.aliases(TYPESENSE_PAGE_ALIAS).retrieve()).collection_name,
    ).toBe(legacyPageCollection);

    const staleId = 'stale-dictionary-document';
    await client
      .collections<TypesenseDictionaryDocument>(TYPESENSE_DICTIONARY_COLLECTION)
      .documents()
      .create({
        id: staleId,
        workspaceId: 'workspace-1',
        spaceId: 'space-1',
        term: 'Stale',
        forms: [],
        definitionText: '',
        updatedAt: 1,
      });
    await (
      service as unknown as {
        deleteDocumentsByIds(
          collection: string,
          documentIds: string[],
        ): Promise<void>;
      }
    ).deleteDocumentsByIds(TYPESENSE_DICTIONARY_COLLECTION, [staleId]);
    await expect(
      client
        .collections(TYPESENSE_DICTIONARY_COLLECTION)
        .documents(staleId)
        .retrieve(),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });

  async function cleanup(): Promise<void> {
    if (!client) return;
    for (const alias of [
      TYPESENSE_PAGE_ALIAS,
      TYPESENSE_ATTACHMENT_ALIAS,
      TYPESENSE_DICTIONARY_ALIAS,
    ]) {
      await client
        .aliases(alias)
        .delete()
        .catch((error: { httpStatus?: number }) => {
          if (error.httpStatus !== 404) throw error;
        });
    }
    for (const collection of [
      TYPESENSE_PAGE_COLLECTION,
      TYPESENSE_ATTACHMENT_COLLECTION,
      TYPESENSE_DICTIONARY_COLLECTION,
      legacyPageCollection,
    ]) {
      await client
        .collections(collection)
        .delete()
        .catch((error: { httpStatus?: number }) => {
          if (error.httpStatus !== 404) throw error;
        });
    }
  }
});
