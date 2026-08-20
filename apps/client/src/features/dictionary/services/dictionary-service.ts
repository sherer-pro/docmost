import api from "@/lib/api-client";
import {
  ICreateDictionaryTermPayload,
  IDictionaryTerm,
  IDictionaryPortableTerm,
  IDictionaryWordFormGenerationStatus,
  IGenerateAllDictionaryWordFormsResult,
  IGenerateDictionaryWordFormsPayload,
  IGenerateDictionaryWordFormsResult,
  IImportDictionaryTermsPayload,
  IImportDictionaryTermsResult,
  IUpdateDictionaryTermPayload,
} from "@/features/dictionary/types/dictionary.types";
import { downloadBlobFromAxiosResponse } from "@/lib/download";

export async function getDictionaryTerms(
  spaceId: string,
): Promise<IDictionaryTerm[]> {
  const req = await api.get<IDictionaryTerm[]>("/dictionary-terms", {
    params: { spaceId },
  });

  return req.data;
}

export async function getDictionaryTerm(
  termId: string,
): Promise<IDictionaryTerm> {
  const req = await api.get<IDictionaryTerm>(`/dictionary-terms/${termId}`);
  return req.data;
}

export async function createDictionaryTerm(
  payload: ICreateDictionaryTermPayload,
): Promise<IDictionaryTerm> {
  const req = await api.post<IDictionaryTerm>("/dictionary-terms", payload);
  return req.data;
}

export async function updateDictionaryTerm(
  termId: string,
  payload: IUpdateDictionaryTermPayload,
): Promise<IDictionaryTerm> {
  const req = await api.patch<IDictionaryTerm>(
    `/dictionary-terms/${termId}`,
    payload,
  );

  return req.data;
}

export async function deleteDictionaryTerm(termId: string): Promise<void> {
  await api.delete(`/dictionary-terms/${termId}`);
}

export async function getDictionaryWordFormGenerationStatus(
  spaceId: string,
): Promise<IDictionaryWordFormGenerationStatus> {
  const req = await api.get<IDictionaryWordFormGenerationStatus>(
    "/dictionary-terms/word-form-generation/status",
    { params: { spaceId } },
  );
  return req.data;
}

export async function generateDictionaryWordForms(
  payload: IGenerateDictionaryWordFormsPayload,
): Promise<IGenerateDictionaryWordFormsResult> {
  const req = await api.post<IGenerateDictionaryWordFormsResult>(
    "/dictionary-terms/actions/generate-word-forms",
    payload,
  );
  return req.data;
}

export async function generateAllDictionaryWordForms(
  spaceId: string,
): Promise<IGenerateAllDictionaryWordFormsResult> {
  const req = await api.post<IGenerateAllDictionaryWordFormsResult>(
    "/dictionary-terms/actions/generate-all-word-forms",
    { spaceId },
  );
  return req.data;
}

export async function exportDictionaryTerms(spaceId: string): Promise<void> {
  const req = await api.post<Blob>(
    "/dictionary-terms/actions/export",
    { spaceId },
    {
      responseType: "blob",
      skipEnvelopeUnwrap: true,
    },
  );

  downloadBlobFromAxiosResponse(req, "dictionary.json");
}

export async function importDictionaryTerms(
  payload: IImportDictionaryTermsPayload,
): Promise<IImportDictionaryTermsResult> {
  const req = await api.post<IImportDictionaryTermsResult>(
    "/dictionary-terms/actions/import",
    payload,
  );

  return req.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseDictionaryImportJson(
  jsonText: string,
): IDictionaryPortableTerm[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Invalid dictionary JSON file");
  }

  const rawTerms = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.terms)
      ? parsed.terms
      : null;

  if (!rawTerms) {
    throw new Error("Invalid dictionary JSON file");
  }

  return rawTerms.map((rawTerm) => {
    if (
      !isRecord(rawTerm) ||
      typeof rawTerm.term !== "string" ||
      typeof rawTerm.definitionMarkdown !== "string"
    ) {
      throw new Error("Invalid dictionary JSON file");
    }

    if (
      typeof rawTerm.forms !== "undefined" &&
      (!Array.isArray(rawTerm.forms) ||
        rawTerm.forms.some((form) => typeof form !== "string"))
    ) {
      throw new Error("Invalid dictionary JSON file");
    }

    return {
      term: rawTerm.term,
      forms: Array.isArray(rawTerm.forms) ? rawTerm.forms : [],
      definitionMarkdown: rawTerm.definitionMarkdown,
    };
  });
}
