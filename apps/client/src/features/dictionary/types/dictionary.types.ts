export interface IDictionaryTerm {
  id: string;
  spaceId: string;
  workspaceId: string;
  term: string;
  forms: string[];
  definitionMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface ICreateDictionaryTermPayload {
  spaceId: string;
  term: string;
  forms?: string[];
  definitionMarkdown: string;
}

export interface IUpdateDictionaryTermPayload {
  term?: string;
  forms?: string[];
  definitionMarkdown?: string;
}

export interface IDictionaryPortableTerm {
  term: string;
  forms?: string[];
  definitionMarkdown: string;
}

export interface IDictionaryExportPayload {
  version: 1;
  exportedAt: string;
  terms: IDictionaryPortableTerm[];
}

export interface IImportDictionaryTermsPayload {
  spaceId: string;
  terms: IDictionaryPortableTerm[];
}

export interface IImportDictionaryTermsResult {
  created: number;
  updated: number;
  total: number;
}

export interface IDictionaryWordFormGenerationStatus {
  available: boolean;
}

export interface IGenerateDictionaryWordFormsPayload {
  spaceId: string;
  term: string;
  forms?: string[];
}

export interface IGenerateDictionaryWordFormsResult {
  forms: string[];
}

export interface IGenerateAllDictionaryWordFormsResult {
  updatedTerms: number;
  generatedForms: number;
}
