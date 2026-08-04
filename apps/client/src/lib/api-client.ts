import axios, {
  AxiosRequestConfig,
  AxiosHeaders,
  AxiosInstance,
  AxiosResponse,
} from "axios";
import APP_ROUTE from "@/lib/app-route.ts";
import { isCloud } from "@/lib/config.ts";
import type {
  ApiResponseEnvelope,
  AuthenticationAssuranceRequiredError,
} from "@docmost/api-contract";
import { notifications } from "@mantine/notifications";
import i18n from "@/i18n.ts";

type ApiRequestConfig<D = unknown> = AxiosRequestConfig<D> & {
  skipEnvelopeUnwrap?: false;
};

type RawApiRequestConfig<D = unknown> = AxiosRequestConfig<D> &
  ({ skipEnvelopeUnwrap: true } | { responseType: "blob" });

type ApiClient = Omit<
  AxiosInstance,
  "delete" | "get" | "head" | "options" | "patch" | "post" | "put" | "request"
> & {
  request<T = any, D = any>(
    config: RawApiRequestConfig<D>,
  ): Promise<AxiosResponse<T, D>>;
  request<T = any, D = any>(
    config: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
  get<T = any, D = any>(
    url: string,
    config: RawApiRequestConfig<D>,
  ): Promise<AxiosResponse<T, D>>;
  get<T = any, D = any>(
    url: string,
    config?: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
  delete<T = any, D = any>(
    url: string,
    config?: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
  head<T = any, D = any>(
    url: string,
    config?: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
  options<T = any, D = any>(
    url: string,
    config?: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
  post<T = any, D = any>(
    url: string,
    data: D | undefined,
    config: RawApiRequestConfig<D>,
  ): Promise<AxiosResponse<T, D>>;
  post<T = any, D = any>(
    url: string,
    data?: D,
    config?: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
  put<T = any, D = any>(
    url: string,
    data: D | undefined,
    config: RawApiRequestConfig<D>,
  ): Promise<AxiosResponse<T, D>>;
  put<T = any, D = any>(
    url: string,
    data?: D,
    config?: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
  patch<T = any, D = any>(
    url: string,
    data: D | undefined,
    config: RawApiRequestConfig<D>,
  ): Promise<AxiosResponse<T, D>>;
  patch<T = any, D = any>(
    url: string,
    data?: D,
    config?: ApiRequestConfig<D>,
  ): Promise<ApiResponseEnvelope<T>>;
};

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
}) as ApiClient;

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * Explicitly disables automatic API-envelope unwrap (`{ data, success, status }`).
     *
     * Used in specific cases (for example file export) where caller code
     * needs headers, binary body, and other full `AxiosResponse` fields.
     */
    skipEnvelopeUnwrap?: boolean;
    skipAuthRedirect?: boolean;
  }
}

/**
 * Decides whether full `AxiosResponse` must be returned without unwrap.
 *
 * Rules are URL-agnostic:
 * 1) `responseType === 'blob'` for binary downloads (headers + data are required);
 * 2) `config.skipEnvelopeUnwrap === true` as explicit opt-out.
 */
function shouldSkipEnvelopeUnwrap(config: {
  responseType?: string;
  skipEnvelopeUnwrap?: boolean;
}): boolean {
  return config.responseType === "blob" || Boolean(config.skipEnvelopeUnwrap);
}

export function isApiResponseEnvelope<T>(
  value: unknown,
): value is ApiResponseEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "success" in value &&
    "status" in value
  );
}

export function unwrapApiResponse<T>(value: unknown): T {
  return isApiResponseEnvelope<T>(value) ? (value.data as T) : (value as T);
}

export function isAuthenticationAssuranceMutationError(error: any): boolean {
  const method = error?.config?.method?.toUpperCase() ?? "GET";
  return (
    error?.response?.status === 428 &&
    error?.response?.data?.code === "AUTHENTICATION_ASSURANCE_REQUIRED" &&
    !["GET", "HEAD", "OPTIONS"].includes(method)
  );
}

export const AUTHENTICATION_ASSURANCE_REQUIRED_EVENT =
  "docmost:authentication-assurance-required";

export function getAuthenticationAssuranceReadError(
  error: any,
): AuthenticationAssuranceRequiredError | null {
  const method = error?.config?.method?.toUpperCase() ?? "GET";
  const data = error?.response?.data;
  if (
    error?.response?.status !== 428 ||
    data?.code !== "AUTHENTICATION_ASSURANCE_REQUIRED" ||
    !["GET", "HEAD", "OPTIONS"].includes(method)
  ) {
    return null;
  }

  return data as AuthenticationAssuranceRequiredError;
}

/**
 * Reads a cookie value by its name.
 *
 * Used by the double-submit CSRF flow: the client reads `csrfToken`
 * from cookies and forwards it in the `x-csrf-token` header for mutating requests.
 */
function getCookieValue(name: string): string | null {
  const escapedName = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${escapedName}=([^;]*)`),
  );

  return match ? decodeURIComponent(match[1]) : null;
}

export function withCsrfHeader(headers: HeadersInit = {}): Headers {
  const nextHeaders = new Headers(headers);
  const csrfToken = getCookieValue("csrfToken");

  if (csrfToken) {
    nextHeaders.set("x-csrf-token", csrfToken);
  }

  return nextHeaders;
}

api.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase() ?? "GET";
  const isMutatingRequest = !["GET", "HEAD", "OPTIONS"].includes(method);

  if (isMutatingRequest) {
    const csrfToken = getCookieValue("csrfToken");
    if (csrfToken) {
      if (config.headers?.set) {
        config.headers.set("x-csrf-token", csrfToken);
      } else {
        const headers = AxiosHeaders.from(config.headers);
        headers.set("x-csrf-token", csrfToken);
        config.headers = headers;
      }
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => {
    if (shouldSkipEnvelopeUnwrap(response.config)) {
      return response;
    }

    return response.data;
  },
  (error) => {
    if (error.response) {
      if (isAuthenticationAssuranceMutationError(error)) {
        notifications.show({
          id: "authentication-assurance-required",
          color: "yellow",
          message: i18n.t("Additional authentication required"),
        });
      }

      const assuranceReadError = getAuthenticationAssuranceReadError(error);
      if (assuranceReadError && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(AUTHENTICATION_ASSURANCE_REQUIRED_EVENT, {
            detail: assuranceReadError,
          }),
        );
      }

      switch (error.response.status) {
        case 401: {
          if (error.config?.skipAuthRedirect) break;
          const url = new URL(error.request.responseURL)?.pathname;
          if (url === "/api/auth/collab-token") return;
          if (window.location.pathname.startsWith("/share/")) return;

          // Handle unauthorized error
          redirectToLogin();
          break;
        }
        case 403:
          // Handle forbidden error
          break;
        case 404:
          // Handle not found error
          if (
            error.response.data.message
              .toLowerCase()
              .includes("workspace not found")
          ) {
            console.log("workspace not found");
            if (
              !isCloud() &&
              window.location.pathname != APP_ROUTE.AUTH.SETUP
            ) {
              window.location.href = APP_ROUTE.AUTH.SETUP;
            }
          }
          break;
        case 500:
          // Handle internal server error
          break;
        default:
          break;
      }
    }
    return Promise.reject(error);
  },
);

function redirectToLogin() {
  const exemptPaths = [
    APP_ROUTE.AUTH.LOGIN,
    APP_ROUTE.AUTH.SIGNUP,
    APP_ROUTE.AUTH.FORGOT_PASSWORD,
    APP_ROUTE.AUTH.PASSWORD_RESET,
    "/invites",
  ];
  if (!exemptPaths.some((path) => window.location.pathname.startsWith(path))) {
    const params = new URLSearchParams();
    const returnTo = `${window.location.pathname}${window.location.search}`;
    params.set("returnTo", returnTo);
    const spaceMatch = window.location.pathname.match(/^\/s\/([^/]+)/);
    if (spaceMatch?.[1]) {
      params.set("spaceSlug", decodeURIComponent(spaceMatch[1]));
    }
    window.location.href = `${APP_ROUTE.AUTH.LOGIN}?${params}`;
  }
}

export default api;
