import { useMutation, useQuery, UseQueryResult } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { useTranslation } from "react-i18next";
import { queryClient } from "@/main.tsx";
import {
  createDictionaryTerm,
  deleteDictionaryTerm,
  getDictionaryTerms,
  updateDictionaryTerm,
} from "@/features/dictionary/services/dictionary-service";
import {
  ICreateDictionaryTermPayload,
  IDictionaryTerm,
  IUpdateDictionaryTermPayload,
} from "@/features/dictionary/types/dictionary.types";
import { useQueryEmit } from "@/features/websocket/use-query-emit";

export const DICTIONARY_QUERY_KEYS = {
  terms: (spaceId?: string): string[] =>
    ["dictionaryTerms", spaceId].filter(Boolean) as string[],
};

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
        message:
          error["response"]?.data?.message || t("Failed to delete term"),
        color: "red",
      });
    },
  });
}
