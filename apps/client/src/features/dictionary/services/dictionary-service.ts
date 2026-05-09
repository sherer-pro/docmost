import api from "@/lib/api-client";
import {
  ICreateDictionaryTermPayload,
  IDictionaryTerm,
  IUpdateDictionaryTermPayload,
} from "@/features/dictionary/types/dictionary.types";

export async function getDictionaryTerms(
  spaceId: string,
): Promise<IDictionaryTerm[]> {
  const req = await api.get<IDictionaryTerm[]>("/dictionary-terms", {
    params: { spaceId },
  });

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
