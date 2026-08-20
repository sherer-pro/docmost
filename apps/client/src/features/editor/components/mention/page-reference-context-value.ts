import { createContext } from "react";
import type { PageReference } from "@docmost/api-contract";

export interface PageReferenceContextValue {
  references: ReadonlyMap<string, PageReference>;
  register: (pageId: string) => void;
}

export const PageReferenceContext =
  createContext<PageReferenceContextValue | null>(null);
