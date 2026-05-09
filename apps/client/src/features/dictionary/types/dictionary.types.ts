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
