import { Modal, Portal, Tabs, ScrollArea, Text } from "@mantine/core";
import SpaceMembersList from "@/features/space/components/space-members.tsx";
import AddSpaceMembersModal from "@/features/space/components/add-space-members-modal.tsx";
import React from "react";
import SpaceDetails from "@/features/space/components/space-details.tsx";
import { useSpaceQuery } from "@/features/space/queries/space-query.ts";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";
import { useTranslation } from "react-i18next";
import classes from "./settings-modal.module.css";
import { useAtomValue } from "jotai";
import { userAtom } from "@/features/user/atoms/current-user-atom.ts";
import { hasFullSpaceAccess } from "@/features/space/permissions/export-access.ts";
import { AiSpaceSettingsSummary } from "@/features/ai/components/ai-space-settings-summary.tsx";
import { useMediaQuery } from "@mantine/hooks";
import { useAiAssistantIdentity } from "@/features/ai/hooks/use-ai-assistant-identity.ts";

interface SpaceSettingsModalProps {
  spaceId: string;
  opened: boolean;
  onClose: () => void;
}

export default function SpaceSettingsModal({
  spaceId,
  opened,
  onClose,
}: SpaceSettingsModalProps) {
  const { t } = useTranslation();
  const { data: space, isLoading } = useSpaceQuery(spaceId);
  const user = useAtomValue(userAtom);
  const isMobile = useMediaQuery("(max-width: 48em)");
  const assistantIdentity = useAiAssistantIdentity(
    opened ? space?.id : undefined,
  );

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);
  const canManageSpaceSettings = hasFullSpaceAccess({
    workspaceRole: user?.role,
    spaceRole: space?.membership?.role,
  });

  if (!opened || isLoading || !space || !canManageSpaceSettings) {
    return null;
  }

  return (
    <Portal>
      <Modal.Root
        opened={opened}
        onClose={onClose}
        size={680}
        padding="lg"
        yOffset={20}
        xOffset={20}
        fullScreen={Boolean(isMobile)}
        classNames={{
          body: classes.body,
          content: classes.content,
          inner: classes.inner,
        }}
      >
        <Modal.Overlay />
        <Modal.Content
          style={{
            maxWidth: isMobile ? "100vw" : "min(680px, calc(100vw - 40px))",
            width: isMobile ? "100vw" : "min(680px, calc(100vw - 40px))",
          }}
        >
          <Modal.Header py={0}>
            <Modal.Title>
              <Text fw={500} lineClamp={1}>
                {space?.name}
              </Text>
            </Modal.Title>
            <Modal.CloseButton
              aria-label={t("Close")}
              className={classes.closeButton}
            />
          </Modal.Header>
          <Modal.Body>
            <div className={classes.layout}>
              <Tabs defaultValue="general" className={classes.tabs}>
                <Tabs.List className={classes.tabsList}>
                  <Tabs.Tab fw={500} value="general">
                    {t("Settings")}
                  </Tabs.Tab>
                  <Tabs.Tab fw={500} value="members">
                    {t("Members")}
                  </Tabs.Tab>
                  <Tabs.Tab fw={500} value="ai">
                    {assistantIdentity.name}
                  </Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="general" className={classes.panel}>
                  <ScrollArea
                    className={classes.panelScroll}
                    scrollbarSize={5}
                    pr={8}
                  >
                    <div className={classes.generalContent}>
                      <SpaceDetails
                        spaceId={space.id}
                        readOnly={spaceAbility.cannot(
                          SpaceCaslAction.Manage,
                          SpaceCaslSubject.Settings,
                        )}
                      />
                    </div>
                  </ScrollArea>
                </Tabs.Panel>

                <Tabs.Panel value="members" className={classes.panel}>
                  <ScrollArea
                    className={classes.panelScroll}
                    scrollbarSize={5}
                    pr={8}
                  >
                    <div className={classes.generalContent}>
                      <div className={classes.membersToolbar}>
                        {spaceAbility.can(
                          SpaceCaslAction.Manage,
                          SpaceCaslSubject.Member,
                        ) && <AddSpaceMembersModal spaceId={space.id} />}
                      </div>

                      <SpaceMembersList
                        spaceId={space.id}
                        readOnly={spaceAbility.cannot(
                          SpaceCaslAction.Manage,
                          SpaceCaslSubject.Member,
                        )}
                      />
                    </div>
                  </ScrollArea>
                </Tabs.Panel>

                <Tabs.Panel value="ai" className={classes.panel}>
                  <ScrollArea
                    className={classes.panelScroll}
                    scrollbarSize={5}
                    pr={8}
                  >
                    <div className={classes.generalContent}>
                      <AiSpaceSettingsSummary
                        spaceId={space.id}
                        spaceSlug={space.slug}
                        onNavigate={onClose}
                      />
                    </div>
                  </ScrollArea>
                </Tabs.Panel>
              </Tabs>
            </div>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </Portal>
  );
}
