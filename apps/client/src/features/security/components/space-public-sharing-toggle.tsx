import { Badge, Group, SegmentedControl, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { useAtomValue } from "jotai";
import {
  userAtom,
  workspaceAtom,
} from "@/features/user/atoms/current-user-atom.ts";
import { useTranslation } from "react-i18next";
import { ISpace } from "@/features/space/types/space.types.ts";
import { useUpdateSpaceMutation } from "@/features/space/queries/space-query.ts";
import {
  ResponsiveSettingsContent,
  ResponsiveSettingsControl,
  ResponsiveSettingsRow,
} from "@/components/ui/responsive-settings-row.tsx";

type OverrideState = "inherit" | "enabled" | "disabled";
type PolicyKey = "enforceMfa" | "enforceSso" | "disablePublicSharing";

type PolicyDefinition = {
  key: PolicyKey;
  updateKey: PolicyKey;
  label: string;
  description: string;
};

type SpaceSecurityPoliciesProps = {
  space: ISpace;
};

function toState(value: boolean | null | undefined): OverrideState {
  return value == null ? "inherit" : value ? "enabled" : "disabled";
}

function fromState(value: OverrideState): boolean | null {
  return value === "inherit" ? null : value === "enabled";
}

export default function SpaceSecurityPolicies({
  space,
}: SpaceSecurityPoliciesProps) {
  const { t } = useTranslation();
  const user = useAtomValue(userAtom);
  const workspace = useAtomValue(workspaceAtom);
  const updateSpaceMutation = useUpdateSpaceMutation();
  const canLoosen = user?.role === "owner" || user?.role === "admin";

  const workspaceValues = {
    enforceMfa: workspace?.enforceMfa === true,
    enforceSso: workspace?.enforceSso === true,
    disablePublicSharing:
      workspace?.settings?.sharing?.disabled === true,
  };
  const overrides =
    space.policy?.overrides ??
    ({
      enforceMfa: space.settings?.security?.enforceMfa ?? null,
      enforceSso: space.settings?.security?.enforceSso ?? null,
      disablePublicSharing: space.settings?.sharing?.disabled ?? null,
    } as const);
  const effective =
    space.policy?.effective ??
    ({
      enforceMfa: overrides.enforceMfa ?? workspaceValues.enforceMfa,
      enforceSso: overrides.enforceSso ?? workspaceValues.enforceSso,
      disablePublicSharing:
        overrides.disablePublicSharing ??
        workspaceValues.disablePublicSharing,
    } as const);

  const policies: PolicyDefinition[] = [
    {
      key: "enforceMfa",
      updateKey: "enforceMfa",
      label: t("Required two-factor authentication"),
      description: t("Require MFA when accessing content in this space."),
    },
    {
      key: "enforceSso",
      updateKey: "enforceSso",
      label: t("Single sign-on (SSO)"),
      description: t("Require SSO when accessing content in this space."),
    },
    {
      key: "disablePublicSharing",
      updateKey: "disablePublicSharing",
      label: t("Disable public sharing"),
      description: t("Prevent pages in this space from being shared publicly."),
    },
  ];

  const applyChange = async (
    definition: PolicyDefinition,
    state: OverrideState,
  ) => {
    await updateSpaceMutation.mutateAsync({
      spaceId: space.id,
      [definition.updateKey]: fromState(state),
    });
  };

  const handleChange = (
    definition: PolicyDefinition,
    nextState: OverrideState,
  ) => {
    const nextOverride = fromState(nextState);
    const currentEffective = effective[definition.key];
    const nextEffective =
      nextOverride ?? workspaceValues[definition.key];
    const deletesShares =
      definition.key === "disablePublicSharing" &&
      !currentEffective &&
      nextEffective;
    const loosensPolicy = currentEffective && !nextEffective;

    if (deletesShares || loosensPolicy) {
      modals.openConfirmModal({
        title: loosensPolicy
          ? t("Loosen space security policy?")
          : t("Disable public sharing"),
        children: (
          <Text size="sm">
            {deletesShares
              ? t(
                  "All existing shared links in this space will be deleted.",
                )
              : t(
                  "This change makes the space policy less strict than its current effective value.",
                )}
          </Text>
        ),
        centered: true,
        labels: { confirm: t("Confirm"), cancel: t("Cancel") },
        confirmProps: { color: loosensPolicy ? "orange" : "red" },
        onConfirm: () => applyChange(definition, nextState),
      });
      return;
    }

    void applyChange(definition, nextState);
  };

  return (
    <Stack gap="md">
      <div>
        <Text fw={600}>{t("Security policies")}</Text>
        <Text size="sm" c="dimmed">
          {t(
            "Space policies inherit workspace defaults unless an override is selected.",
          )}
        </Text>
      </div>

      {policies.map((definition) => {
        const currentState = toState(overrides[definition.key]);
        const isCurrentEffective = effective[definition.key];
        const data = (["inherit", "enabled", "disabled"] as const).map(
          (state) => {
            const override = fromState(state);
            return {
              value: state,
              label:
                state === "inherit"
                  ? t("Inherit")
                  : state === "enabled"
                    ? t("Enabled")
                    : t("Disabled"),
              disabled: !canLoosen && override !== true,
            };
          },
        );

        return (
          <ResponsiveSettingsRow key={definition.key}>
            <ResponsiveSettingsContent>
              <Text size="md">{definition.label}</Text>
              <Text size="sm" c="dimmed">
                {definition.description}
              </Text>
              <Group gap="xs" mt={6}>
                <Badge variant="light" color="gray">
                  {t("Workspace: {{value}}", {
                    value: workspaceValues[definition.key]
                      ? t("Enabled")
                      : t("Disabled"),
                  })}
                </Badge>
                <Badge variant="light" color={isCurrentEffective ? "blue" : "gray"}>
                  {t("Effective: {{value}}", {
                    value: isCurrentEffective
                      ? t("Enabled")
                      : t("Disabled"),
                  })}
                </Badge>
              </Group>
            </ResponsiveSettingsContent>
            <ResponsiveSettingsControl>
              <SegmentedControl
                value={currentState}
                data={data}
                onChange={(value) =>
                  handleChange(definition, value as OverrideState)
                }
                disabled={updateSpaceMutation.isPending}
                aria-label={definition.label}
                size="xs"
              />
            </ResponsiveSettingsControl>
          </ResponsiveSettingsRow>
        );
      })}

      {!canLoosen && (
        <Text size="xs" c="dimmed">
          {t("Space administrators cannot weaken an effective security policy.")}
        </Text>
      )}
    </Stack>
  );
}
