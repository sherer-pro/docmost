import { IImportDictionaryTermsResult } from "@/features/dictionary/types/dictionary.types";

type Translate = (
  key: string,
  options?: Record<string, string | number | boolean>,
) => string;

export function getDictionaryImportSuccessMessage(
  t: Translate,
  result: Pick<IImportDictionaryTermsResult, "created" | "updated">,
): string {
  return t("Imported {{imported}} terms, updated {{updated}} terms", {
    imported: result.created,
    updated: result.updated,
  });
}
