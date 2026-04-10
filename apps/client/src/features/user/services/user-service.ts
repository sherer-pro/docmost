import api from "@/lib/api-client";
import { ICurrentUser, IUser } from "@/features/user/types/user.types";
import { ApiResponseEnvelope } from "@docmost/api-contract";
import {
  DEFAULT_EMAIL_ENABLED,
  DEFAULT_EMAIL_FREQUENCY,
} from "@/features/user/constants/email-preferences.ts";
import {
  DEFAULT_PUSH_ENABLED,
  DEFAULT_PUSH_FREQUENCY,
} from "@/features/user/constants/push-preferences.ts";
import { normalizePageEditMode } from "@/features/user/utils/page-edit-mode.ts";
import {
  normalizeEmailFrequency,
  normalizePreferenceBoolean,
  normalizePushFrequency,
} from "@/features/user/utils/notification-preferences.ts";
import { normalizeFullPageWidthByPageId } from "@/features/user/utils/page-width.ts";

function isEnvelope<T>(value: unknown): value is ApiResponseEnvelope<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "success" in value &&
    "status" in value
  );
}

function unwrapResponse<T>(value: unknown): T {
  return isEnvelope<T>(value) ? (value.data as T) : (value as T);
}

function normalizeUserPreferences(user: IUser): IUser {
  const safeSettings = user?.settings ?? ({} as Partial<IUser["settings"]>);
  const safePreferences = (safeSettings?.preferences ??
    {}) as Partial<IUser["settings"]["preferences"]> &
    Record<string, unknown>;
  const normalizedFullPageWidthByPageId = normalizeFullPageWidthByPageId(
    safePreferences.fullPageWidthByPageId,
  );
  const hasPageWidthOverrides =
    Object.keys(normalizedFullPageWidthByPageId).length > 0;

  return {
    ...user,
    settings: {
      ...safeSettings,
      preferences: {
        ...safePreferences,
        fullPageWidth: normalizePreferenceBoolean(
          safePreferences.fullPageWidth,
          false,
        ),
        ...(hasPageWidthOverrides
          ? { fullPageWidthByPageId: normalizedFullPageWidthByPageId }
          : {}),
        pushEnabled: normalizePreferenceBoolean(
          safePreferences.pushEnabled,
          DEFAULT_PUSH_ENABLED,
        ),
        emailEnabled: normalizePreferenceBoolean(
          safePreferences.emailEnabled,
          DEFAULT_EMAIL_ENABLED,
        ),
        pushFrequency: normalizePushFrequency(
          safePreferences.pushFrequency,
          DEFAULT_PUSH_FREQUENCY,
        ),
        emailFrequency: normalizeEmailFrequency(
          safePreferences.emailFrequency,
          DEFAULT_EMAIL_FREQUENCY,
        ),
        pageEditMode: normalizePageEditMode(safePreferences.pageEditMode),
      },
    },
  };
}

function normalizeCurrentUserResponse(payload: ICurrentUser): ICurrentUser {
  return {
    ...payload,
    user: normalizeUserPreferences(payload.user),
  };
}

/**
 * Fetches the current user's profile through a read-only endpoint.
 *
 * We use GET so the request is not treated as a mutating method by CSRF checks
 * and works correctly even before the CSRF cookie is initialized.
 */
export async function getMyInfo(): Promise<ICurrentUser> {
  const req = await api.get<ICurrentUser>("/users/me", {
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  return normalizeCurrentUserResponse(unwrapResponse<ICurrentUser>(req));
}

export async function updateUser(data: Partial<IUser>): Promise<IUser> {
  const req = await api.post<IUser>("/users/update", data);
  return normalizeUserPreferences(unwrapResponse<IUser>(req));
}
