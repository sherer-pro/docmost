import {
  Alert,
  Button,
  Card,
  Group,
  List,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBook2,
  IconBrain,
  IconChecklist,
  IconChevronRight,
  IconDatabase,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconTool,
  type TablerIcon,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import classes from "./ai-admin-guide.module.css";

type SurfaceCard = {
  color: string;
  descriptionKey: string;
  icon: TablerIcon;
  titleKey: string;
};

const SURFACES: SurfaceCard[] = [
  {
    color: "violet",
    descriptionKey: "ai.adminGuide.assistantDescription",
    icon: IconBrain,
    titleKey: "ai.title",
  },
  {
    color: "blue",
    descriptionKey: "ai.adminGuide.retrievalDescription",
    icon: IconSearch,
    titleKey: "ai.settings.retrievalSection",
  },
  {
    color: "teal",
    descriptionKey: "ai.adminGuide.ragDescription",
    icon: IconDatabase,
    titleKey: "ai.integrations.ragTitle",
  },
  {
    color: "cyan",
    descriptionKey: "ai.ragSync.description",
    icon: IconRefresh,
    titleKey: "ai.ragSync.title",
  },
  {
    color: "indigo",
    descriptionKey: "ai.adminGuide.inboundMcpDescription",
    icon: IconPlugConnected,
    titleKey: "ai.integrations.mcpTitle",
  },
  {
    color: "orange",
    descriptionKey: "ai.adminGuide.outboundMcpDescription",
    icon: IconTool,
    titleKey: "ai.externalTools.title",
  },
];

const SETTINGS_LINKS = [
  { to: "/settings/ai/spaces", labelKey: "ai.integrations.spacesTitle" },
  {
    to: "/settings/ai/built-in-tools",
    labelKey: "ai.toolPolicy.workspaceTitle",
  },
  {
    to: "/settings/ai/external-tools",
    labelKey: "ai.externalTools.title",
  },
  { to: "/settings/keys/rag", labelKey: "ai.integrations.ragTitle" },
  { to: "/settings/keys/mcp", labelKey: "ai.integrations.mcpTitle" },
];

const SYNC_STEPS = [
  "ai.ragSync.deploymentDisabledDescription",
  "ai.ragSync.knowledgeIdDescription",
  "ai.ragSync.writerKeyRequired",
  "ai.adminGuide.syncStepDelta",
  "ai.ragSync.cleanupRequiredDescription",
];

const SYNC_RISKS = [
  "ai.adminGuide.riskTiming",
  "ai.ragSync.privacyDescription",
  "ai.adminGuide.riskDelivery",
  "ai.ragSync.targetMismatchDescription",
  "ai.adminGuide.riskModel",
];

const SECURITY_ITEMS = [
  "ai.adminGuide.securitySourceAccess",
  "ai.adminGuide.securityInbound",
  "ai.adminGuide.securityOutbound",
  "ai.adminGuide.securitySecrets",
  "ai.adminGuide.securityRemote",
];

const OPERATIONS = [
  "ai.adminGuide.operationsSetup",
  "ai.adminGuide.operationsRagMigration",
  "ai.ragSync.test",
  "ai.ragSync.lastSuccess",
  "ai.adminGuide.operationsRecovery",
];

export default function AiAdminGuide() {
  const { t } = useTranslation();

  return (
    <Stack gap="xl">
      <Card withBorder radius="lg" className={classes.hero}>
        <Group wrap="nowrap" align="flex-start">
          <ThemeIcon size={48} radius="md" variant="light" color="violet">
            <IconBook2 size={26} stroke={1.8} />
          </ThemeIcon>
          <div className={classes.heroContent}>
            <Title order={2} size="h3" id="ai-admin-guide-title">
              {t("ai.adminGuide.title")}
            </Title>
            <Text c="dimmed" mt={4} maw={820}>
              {t("ai.adminGuide.description")}
            </Text>
          </div>
        </Group>
      </Card>

      <section aria-labelledby="ai-guide-overview-title">
        <Title order={3} size="h4" id="ai-guide-overview-title" mb={4}>
          {t("ai.adminGuide.overviewTitle")}
        </Title>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" mt="md">
          {SURFACES.map((surface) => {
            const Icon = surface.icon;
            return (
              <Card
                key={surface.descriptionKey}
                withBorder
                radius="md"
                p="md"
                className={classes.surfaceCard}
              >
                <Stack gap="sm">
                  <ThemeIcon
                    variant="light"
                    color={surface.color}
                    radius="md"
                    size="lg"
                  >
                    <Icon size={19} stroke={1.9} />
                  </ThemeIcon>
                  <Text fw={650}>{t(surface.titleKey)}</Text>
                  <Text size="sm" c="dimmed">
                    {t(surface.descriptionKey)}
                  </Text>
                </Stack>
              </Card>
            );
          })}
        </SimpleGrid>
      </section>

      <section aria-labelledby="ai-guide-settings-title">
        <Title order={3} size="h4" id="ai-guide-settings-title">
          {t("ai.adminGuide.setupTitle")}
        </Title>
        <Text size="sm" c="dimmed" mt={4} mb="md">
          {t("ai.adminGuide.setupDescription")}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
          {SETTINGS_LINKS.map((link) => (
            <Button
              key={link.to}
              component={Link}
              to={link.to}
              variant="light"
              justify="space-between"
              rightSection={<IconChevronRight size={16} />}
              className={classes.settingsLink}
            >
              {t(link.labelKey)}
            </Button>
          ))}
        </SimpleGrid>
      </section>

      <section aria-labelledby="ai-guide-sync-title">
        <Group gap="sm" align="center" mb={4}>
          <ThemeIcon variant="light" color="teal" radius="md">
            <IconRefresh size={18} />
          </ThemeIcon>
          <Title order={3} size="h4" id="ai-guide-sync-title">
            {t("ai.adminGuide.syncTitle")}
          </Title>
        </Group>
        <Text size="sm" c="dimmed" mb="md" maw={900}>
          {t("ai.adminGuide.syncDescription")}
        </Text>
        <Stack gap="sm">
          {SYNC_STEPS.map((key, index) => (
            <Card key={key} withBorder radius="md" p="md">
              <Group wrap="nowrap" align="flex-start">
                <ThemeIcon
                  variant="filled"
                  color="teal"
                  radius="xl"
                  size="md"
                  className={classes.stepNumber}
                >
                  {index + 1}
                </ThemeIcon>
                <Text size="sm">{t(key)}</Text>
              </Group>
            </Card>
          ))}
        </Stack>

        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={20} />}
          title={t("ai.adminGuide.riskTitle")}
          mt="md"
        >
          <List size="sm" spacing="xs" withPadding>
            {SYNC_RISKS.map((key) => (
              <List.Item key={key}>{t(key)}</List.Item>
            ))}
          </List>
        </Alert>
      </section>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card
          component="section"
          aria-labelledby="ai-guide-security-title"
          withBorder
          radius="md"
          p="lg"
        >
          <Group gap="sm" mb="md">
            <ThemeIcon variant="light" color="blue" radius="md">
              <IconShieldCheck size={18} />
            </ThemeIcon>
            <Title order={3} size="h4" id="ai-guide-security-title">
              {t("ai.adminGuide.securityTitle")}
            </Title>
          </Group>
          <List size="sm" spacing="sm" withPadding>
            {SECURITY_ITEMS.map((key) => (
              <List.Item key={key}>{t(key)}</List.Item>
            ))}
          </List>
        </Card>

        <Card
          component="section"
          aria-labelledby="ai-guide-operations-title"
          withBorder
          radius="md"
          p="lg"
        >
          <Group gap="sm" mb="md">
            <ThemeIcon variant="light" color="green" radius="md">
              <IconChecklist size={18} />
            </ThemeIcon>
            <Title order={3} size="h4" id="ai-guide-operations-title">
              {t("ai.adminGuide.operationsTitle")}
            </Title>
          </Group>
          <List size="sm" spacing="sm" withPadding>
            {OPERATIONS.map((key) => (
              <List.Item key={key}>{t(key)}</List.Item>
            ))}
          </List>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
