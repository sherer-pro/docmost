import { useMutation, useQuery, UseQueryResult } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { queryClient } from "@/lib/query-client.ts";
import {
  createDictionaryTerm,
  deleteDictionaryTerm,
  exportDictionaryTerms,
  generateAllDictionaryWordForms,
  generateDictionaryWordForms,
  getDictionaryTerms,
  getDictionaryTerm,
  getDictionaryWordFormGenerationStatus,
  importDictionaryTerms,
  updateDictionaryTerm,
} from "@/features/dictionary/services/dictionary-service";
import {
  ICreateDictionaryTermPayload,
  IDictionaryTerm,
  IDictionaryWordFormGenerationStatus,
  IGenerateAllDictionaryWordFormsResult,
  IGenerateDictionaryWordFormsPayload,
  IGenerateDictionaryWordFormsResult,
  IImportDictionaryTermsPayload,
  IImportDictionaryTermsResult,
  IUpdateDictionaryTermPayload,
} from "@/features/dictionary/types/dictionary.types";
import { getDictionaryImportSuccessMessage } from "@/features/dictionary/utils/dictionary-import-notification";
import { useQueryEmit } from "@/features/websocket/use-query-emit";

const DICTIONARY_QUERY_KEYS = {
  terms: (spaceId?: string): string[] =>
    ["dictionaryTerms", spaceId].filter(Boolean) as string[],
  term: (termId?: string): string[] =>
    ["dictionaryTerm", termId].filter(Boolean) as string[],
  wordFormGenerationStatus: (spaceId?: string): string[] =>
    ["dictionaryWordFormGenerationStatus", spaceId].filter(Boolean) as string[],
};

export function useDictionaryTermQuery(
  termId?: string,
  enabled = true,
): UseQueryResult<IDictionaryTerm, Error> {
  return useQuery({
    queryKey: DICTIONARY_QUERY_KEYS.term(termId),
    queryFn: () => getDictionaryTerm(termId as string),
    enabled: Boolean(termId && enabled),
  });
}

export function useDictionaryTermsQuery(
  spaceId?: string,
  enabled = true,
): UseQueryResult<IDictionaryTerm[], Error> {
  return useQuery({
    queryKey: DICTIONARY_QUERY_KEYS.terms(spaceId),
    queryFn: () => getDictionaryTerms(spaceId as string),
    enabled: Boolean(spaceId && enabled),
  });
}

export function useDictionaryWordFormGenerationStatusQuery(
  spaceId?: string,
  enabled = true,
): UseQueryResult<IDictionaryWordFormGenerationStatus, Error> {
  return useQuery({
    queryKey: DICTIONARY_QUERY_KEYS.wordFormGenerationStatus(spaceId),
    queryFn: () => getDictionaryWordFormGenerationStatus(spaceId as string),
    enabled: Boolean(spaceId && enabled),
  });
}

export function useGenerateDictionaryWordFormsMutation() {
  const { t } = useTranslation();

  return useMutation<
    IGenerateDictionaryWordFormsResult,
    Error,
    IGenerateDictionaryWordFormsPayload
  >({
    mutationFn: generateDictionaryWordForms,
    onError: (error) => {
      notifications.show({
        message:
          error["response"]?.data?.message ||
          t("Failed to generate word forms"),
        color: "red",
      });
    },
  });
}

export function useGenerateAllDictionaryWordFormsMutation() {
  const { t } = useTranslation();
  const emit = useQueryEmit();

  return useMutation<IGenerateAllDictionaryWordFormsResult, Error, string>({
    mutationFn: generateAllDictionaryWordForms,
    onSuccess: (result, generatedSpaceId) => {
      queryClient.invalidateQueries({
        queryKey: DICTIONARY_QUERY_KEYS.terms(generatedSpaceId),
      });
      emit({
        operation: "invalidate",
        spaceId: generatedSpaceId,
        entity: DICTIONARY_QUERY_KEYS.terms(generatedSpaceId),
      });
      notifications.show({
        message: t("Word forms generated for {{count}} terms", {
          count: result.updatedTerms,
        }),
      });
    },
    onError: (error) => {
      notifications.show({
        message:
          error["response"]?.data?.message ||
          t("Failed to generate word forms"),
        color: "red",
      });
    },
  });
}

export function useCreateDictionaryTermMutation(spaceId?: string) {
  const { t } = useTranslation();
  const emit = useQueryEmit();

  return useMutation<IDictionaryTerm, Error, ICreateDictionaryTermPayload>({
    mutationFn: createDictionaryTerm,
    onSuccess: (term) => {
      queryClient.invalidateQueries({
        queryKey: DICTIONARY_QUERY_KEYS.terms(term.spaceId),
      });
      emit({
        operation: "invalidate",
        spaceId: term.spaceId,
        entity: DICTIONARY_QUERY_KEYS.terms(term.spaceId),
      });
      notifications.show({ message: t("Dictionary term created") });
    },
    onError: (error) => {
      notifications.show({
        message: error["response"]?.data?.message || t("Failed to save term"),
        color: "red",
      });
    },
  });
}

export function useUpdateDictionaryTermMutation(spaceId?: string) {
  const { t } = useTranslation();
  const emit = useQueryEmit();

  return useMutation<
    IDictionaryTerm,
    Error,
    { termId: string; payload: IUpdateDictionaryTermPayload }
  >({
    mutationFn: ({ termId, payload }) => updateDictionaryTerm(termId, payload),
    onSuccess: (term) => {
      queryClient.invalidateQueries({
        queryKey: DICTIONARY_QUERY_KEYS.terms(term.spaceId),
      });
      emit({
        operation: "invalidate",
        spaceId: term.spaceId,
        entity: DICTIONARY_QUERY_KEYS.terms(term.spaceId),
      });
      notifications.show({ message: t("Dictionary term updated") });
    },
    onError: (error) => {
      notifications.show({
        message: error["response"]?.data?.message || t("Failed to save term"),
        color: "red",
      });
    },
  });
}

export function useDeleteDictionaryTermMutation(spaceId?: string) {
  const { t } = useTranslation();
  const emit = useQueryEmit();

  return useMutation<void, Error, string>({
    mutationFn: deleteDictionaryTerm,
    onSuccess: () => {
      if (spaceId) {
        queryClient.invalidateQueries({
          queryKey: DICTIONARY_QUERY_KEYS.terms(spaceId),
        });
        emit({
          operation: "invalidate",
          spaceId,
          entity: DICTIONARY_QUERY_KEYS.terms(spaceId),
        });
      }

      notifications.show({ message: t("Dictionary term deleted") });
    },
    onError: (error) => {
      notifications.show({
        message: error["response"]?.data?.message || t("Failed to delete term"),
        color: "red",
      });
    },
  });
}

export function useExportDictionaryTermsMutation() {
  const { t } = useTranslation();

  return useMutation<void, Error, string>({
    mutationFn: exportDictionaryTerms,
    onSuccess: () => {
      notifications.show({ message: t("Dictionary terms exported") });
    },
    onError: (error) => {
      notifications.show({
        message:
          error["response"]?.data?.message ||
          t("Failed to export dictionary terms"),
        color: "red",
      });
    },
  });
}

export function useImportDictionaryTermsMutation() {
  const { t } = useTranslation();
  const emit = useQueryEmit();

  return useMutation<
    IImportDictionaryTermsResult,
    Error,
    IImportDictionaryTermsPayload
  >({
    mutationFn: importDictionaryTerms,
    onSuccess: (result, payload) => {
      queryClient.invalidateQueries({
        queryKey: DICTIONARY_QUERY_KEYS.terms(payload.spaceId),
      });
      emit({
        operation: "invalidate",
        spaceId: payload.spaceId,
        entity: DICTIONARY_QUERY_KEYS.terms(payload.spaceId),
      });
      notifications.show({
        message: getDictionaryImportSuccessMessage(t, result),
      });
    },
    onError: (error) => {
      notifications.show({
        message:
          error["response"]?.data?.message ||
          t("Failed to import dictionary terms"),
        color: "red",
      });
    },
  });
}
