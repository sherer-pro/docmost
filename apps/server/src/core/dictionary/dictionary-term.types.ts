export interface DictionaryTermResponse {
  id: string;
  spaceId: string;
  workspaceId: string;
  term: string;
  forms: string[];
  definitionMarkdown: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DictionaryPortableTerm {
  term: string;
  forms: string[];
  definitionMarkdown: string;
}

export interface DictionaryExportResponse {
  version: 1;
  exportedAt: string;
  terms: DictionaryPortableTerm[];
}

export interface DictionaryImportResult {
  created: number;
  updated: number;
  total: number;
}

export interface DictionaryWordFormGenerationResult {
  forms: string[];
}

export interface DictionaryBulkWordFormGenerationResult {
  updatedTerms: number;
  generatedForms: number;
}
