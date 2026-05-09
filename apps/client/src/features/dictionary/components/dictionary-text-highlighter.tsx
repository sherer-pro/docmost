import { Fragment, ReactNode, useMemo } from "react";
import { DictionaryHighlightLayer } from "./dictionary-highlight-layer";
import { IDictionaryTerm } from "@/features/dictionary/types/dictionary.types";
import { findDictionaryMatches } from "@/features/dictionary/utils/dictionary-matcher";

interface DictionaryTextHighlighterProps {
  text: string;
  terms: IDictionaryTerm[];
  spaceId?: string;
  canCreate?: boolean;
  enableSelectionCreate?: boolean;
  fallback?: ReactNode;
}

export function DictionaryTextHighlighter({
  text,
  terms,
  spaceId,
  canCreate = false,
  enableSelectionCreate = false,
  fallback = null,
}: DictionaryTextHighlighterProps) {
  const matches = useMemo(
    () => findDictionaryMatches(text, terms),
    [terms, text],
  );

  if (!text) {
    return <>{fallback}</>;
  }

  if (matches.length === 0) {
    return (
      <DictionaryHighlightLayer
        terms={terms}
        spaceId={spaceId}
        canCreate={canCreate}
        enableSelectionCreate={enableSelectionCreate}
      >
        {text}
      </DictionaryHighlightLayer>
    );
  }

  let cursor = 0;

  return (
    <DictionaryHighlightLayer
      terms={terms}
      spaceId={spaceId}
      canCreate={canCreate}
      enableSelectionCreate={enableSelectionCreate}
    >
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
              tabIndex={0}
            >
              {highlighted}
            </span>
            {index === matches.length - 1 ? text.slice(cursor) : null}
          </Fragment>
        );
      })}
    </DictionaryHighlightLayer>
  );
}
