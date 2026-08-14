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

interface DictionaryPortableTerm {
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
