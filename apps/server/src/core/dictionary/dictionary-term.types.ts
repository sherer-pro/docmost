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
