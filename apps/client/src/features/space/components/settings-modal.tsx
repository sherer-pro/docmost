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

  const spaceRules = space?.membership?.permissions;
  const spaceAbility = useSpaceAbility(spaceRules);

  return (
    <Portal>
      <Modal.Root
        opened={opened}
        onClose={onClose}
        size={680}
        padding="lg"
        yOffset={20}
        xOffset={20}
        classNames={{
          body: classes.body,
          content: classes.content,
          inner: classes.inner,
        }}
      >
        <Modal.Overlay />
        <Modal.Content
          style={{
            maxWidth: "min(680px, calc(100vw - 40px))",
            width: "min(680px, calc(100vw - 40px))",
          }}
        >
          <Modal.Header py={0}>
            <Modal.Title>
              <Text fw={500} lineClamp={1}>
                {space?.name}
              </Text>
            </Modal.Title>
            <Modal.CloseButton aria-label={t("Close")} />
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
                </Tabs.List>

                <Tabs.Panel value="general" className={classes.panel}>
                  <ScrollArea
                    className={classes.panelScroll}
                    scrollbarSize={5}
                    pr={8}
                  >
                    <div className={classes.generalContent}>
                      <SpaceDetails
                        spaceId={space?.id}
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
                        ) && <AddSpaceMembersModal spaceId={space?.id} />}
                      </div>

                      <SpaceMembersList
                        spaceId={space?.id}
                        readOnly={spaceAbility.cannot(
                          SpaceCaslAction.Manage,
                          SpaceCaslSubject.Member,
                        )}
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
