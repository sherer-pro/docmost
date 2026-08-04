export type PageEmbedLookup =
  | {
      kind: "page";
      sourcePageId: string;
      slugId: string;
      title: string | null;
      icon: string | null;
      content: unknown;
      sourceUpdatedAt: string;
    }
  | {
      kind: "page";
      sourcePageId: string;
      status: "not_found" | "no_access" | "disabled";
    };

export type PageTemplateDiscoveryItem = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  spaceId: string;
  spaceName: string;
  spaceSlug: string;
  updatedAt: string;
  favorite: boolean;
  recent: boolean;
  actions: { snapshot: boolean; liveEmbed: boolean; manage: boolean };
};
