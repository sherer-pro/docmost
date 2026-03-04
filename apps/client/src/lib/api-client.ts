import axios, {
  AxiosHeaders,
  AxiosInstance,
} from "axios";
import APP_ROUTE from "@/lib/app-route.ts";
import { isCloud } from "@/lib/config.ts";

const api: AxiosInstance = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

declare module "axios" {
  interface AxiosRequestConfig {
    /**
     * Явно отключает автоматический unwrap API-envelope (`{ data, success, status }`).
     *
     * Используется в особых сценариях (например, file export), где вызывающему коду
     * нужны заголовки, бинарное тело и другие поля полного `AxiosResponse`.
     */
    skipEnvelopeUnwrap?: boolean;
  }
}

/**
 * Определяет, нужно ли вернуть полный `AxiosResponse` без unwrap.
 *
 * Правила устойчивые и не зависят от конкретного URL:
 * 1) responseType === 'blob' — для бинарных загрузок нужен полный ответ (headers + data);
 * 2) config.skipEnvelopeUnwrap === true — явный opt-out для точечных кейсов.
 */
function shouldSkipEnvelopeUnwrap(config: {
  responseType?: string;
  skipEnvelopeUnwrap?: boolean;
}): boolean {
  return config.responseType === "blob" || Boolean(config.skipEnvelopeUnwrap);
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
      switch (error.response.status) {
        case 401: {
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
    window.location.href = APP_ROUTE.AUTH.LOGIN;
  }
}

export default api;
