import { Fragment, ReactNode, useMemo } from "react";
import { DictionaryHighlightLayer } from "./dictionary-highlight-layer";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import {
  createDictionaryMatcherIndex,
  DictionaryMatcherIndex,
  findDictionaryMatches,
} from "@/features/dictionary/utils/dictionary-matcher";

interface DictionaryTextHighlighterProps {
  text: string;
  terms: IDictionaryTerm[];
  matcherIndex?: DictionaryMatcherIndex;
  spaceId?: string;
  canCreate?: boolean;
  enableSelectionCreate?: boolean;
  withLayer?: boolean;
  fallback?: ReactNode;
}

export function DictionaryTextHighlighter({
  text,
  terms,
  matcherIndex,
  spaceId,
  canCreate = false,
  enableSelectionCreate = false,
  withLayer = true,
  fallback = null,
}: DictionaryTextHighlighterProps) {
  const resolvedMatcherIndex = useMemo(
    () => matcherIndex ?? createDictionaryMatcherIndex(terms),
    [matcherIndex, terms],
  );
  const matches = useMemo(
    () => findDictionaryMatches(text, resolvedMatcherIndex),
    [resolvedMatcherIndex, text],
  );

  const wrapWithLayer = (children: ReactNode) =>
    withLayer ? (
      <DictionaryHighlightLayer
        terms={terms}
        spaceId={spaceId}
        canCreate={canCreate}
        enableSelectionCreate={enableSelectionCreate}
      >
        {children}
      </DictionaryHighlightLayer>
    ) : (
      <>{children}</>
    );

  if (!text) {
    return <>{fallback}</>;
  }

  if (matches.length === 0) {
    return wrapWithLayer(text);
  }

  let cursor = 0;

  return wrapWithLayer(
    <>
      {matches.map((match, index) => {
        const before = text.slice(cursor, match.from);
        const highlighted = text.slice(match.from, match.to);
        cursor = match.to;

        return (
          <Fragment key={`${match.from}-${match.to}-${index}`}>
            {before}
            <span
              className="dictionary-highlight"
              data-dictionary-term-id={match.term.id}
              role="button"
              tabIndex={0}
            >
              {highlighted}
            </span>
            {index === matches.length - 1 ? text.slice(cursor) : null}
          </Fragment>
        );
      })}
    </>,
  );
}
