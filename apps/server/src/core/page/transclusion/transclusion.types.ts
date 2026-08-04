export type TransclusionLookup =
  | {
      sourcePageId: string;
      transclusionId: string;
      content: unknown;
      sourceUpdatedAt: Date;
    }
  | { sourcePageId: string; transclusionId: string; status: 'not_found' }
  | { sourcePageId: string; transclusionId: string; status: 'no_access' };

export type TransclusionNodeSnapshot = {
  transclusionId: string;
  content: unknown;
};

export type PageEmbedLookup =
  | {
      kind: 'page';
      sourcePageId: string;
      slugId: string;
      title: string | null;
      icon: string | null;
      content: unknown;
      sourceUpdatedAt: Date;
    }
  | {
      kind: 'page';
      sourcePageId: string;
      status: 'not_found' | 'no_access' | 'disabled';
    };
