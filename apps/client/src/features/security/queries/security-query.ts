import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  createSsoGroupMapping,
  createSsoProvider,
  deleteSsoGroupMapping,
  deleteSsoProvider,
  getSsoGroupMappings,
  getSsoProviderById,
  getSsoProviders,
  testSsoProvider,
  updateSsoProvider,
} from "@/features/security/services/security-service.ts";
import { notifications } from "@mantine/notifications";
import {
  IAuthProvider,
  ICreateAuthProvider,
  ISsoGroupMapping,
  IUpdateAuthProvider,
} from "@/features/security/types/security.types.ts";
import { IPagination } from "@/lib/types.ts";
import { useTranslation } from "react-i18next";

export function useGetSsoProviders(): UseQueryResult<IPagination<IAuthProvider>, Error> {
  return useQuery({
    queryKey: ["sso-providers"],
    queryFn: () => getSsoProviders(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSsoProvider(
  providerId: string,
): UseQueryResult<IAuthProvider, Error> {
  return useQuery({
    queryKey: ["sso-provider", providerId],
    queryFn: () => getSsoProviderById({ providerId }),
    enabled: !!providerId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateSsoProviderMutation() {
  const queryClient = useQueryClient();

  return useMutation<IAuthProvider, Error, ICreateAuthProvider>({
    mutationFn: (data) => createSsoProvider(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["sso-providers"],
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}

export function useUpdateSsoProviderMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<IAuthProvider, Error, IUpdateAuthProvider>({
    mutationFn: (data) => updateSsoProvider(data),
    onSuccess: () => {
      notifications.show({ message: t("Updated successfully") });
      queryClient.invalidateQueries({
        queryKey: ["sso-providers"],
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}

export function useDeleteSsoProviderMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (providerId: string) => deleteSsoProvider({ providerId }),
    onSuccess: () => {
      notifications.show({ message: t("Deleted successfully") });

      queryClient.invalidateQueries({
        queryKey: ["sso-providers"],
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}

export function useTestSsoProviderMutation() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation<IAuthProvider, Error, string>({
    mutationFn: (providerId) => testSsoProvider({ providerId }),
    onSuccess: () => {
      notifications.show({ message: t("SSO provider configuration verified") });
      queryClient.invalidateQueries({ queryKey: ["sso-providers"] });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
      queryClient.invalidateQueries({ queryKey: ["sso-providers"] });
    },
  });
}

export function useSsoGroupMappings(
  providerId: string,
  enabled = true,
): UseQueryResult<{ items: ISsoGroupMapping[] }, Error> {
  return useQuery({
    queryKey: ["sso-group-mappings", providerId],
    queryFn: () => getSsoGroupMappings({ providerId }),
    enabled: enabled && !!providerId,
  });
}

export function useCreateSsoGroupMappingMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    ISsoGroupMapping,
    Error,
    { providerId: string; externalGroupId: string; groupId: string }
  >({
    mutationFn: (data) => createSsoGroupMapping(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["sso-group-mappings", variables.providerId],
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}

export function useDeleteSsoGroupMappingMutation() {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { mappingId: string; providerId: string }>({
    mutationFn: ({ mappingId }) => deleteSsoGroupMapping({ mappingId }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["sso-group-mappings", variables.providerId],
      });
    },
    onError: (error) => {
      const errorMessage = error["response"]?.data?.message;
      notifications.show({ message: errorMessage, color: "red" });
    },
  });
}
