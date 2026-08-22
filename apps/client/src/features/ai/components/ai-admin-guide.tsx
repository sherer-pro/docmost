import {
  Accordion,
  Alert,
  Button,
  Card,
  Code,
  Group,
  List,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBook2,
  IconBrain,
  IconCheck,
  IconChevronRight,
  IconDatabase,
  IconPlugConnected,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconTool,
  type TablerIcon,
} from "@tabler/icons-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import CopyTextButton from "@/components/common/copy";
import responsiveTableClasses from "@/components/ui/responsive-table.module.css";
import { MermaidDiagram } from "@/features/editor/components/common/mermaid-diagram";
import {
  AI_ADMIN_GUIDE_NAVIGATION_GROUPS,
  AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS,
  AI_ADMIN_GUIDE_SCENARIOS,
  AI_ADMIN_GUIDE_SECURITY_PRINCIPLES,
  AI_ADMIN_GUIDE_SECURITY_ROWS,
  AI_ADMIN_GUIDE_TROUBLESHOOTING_GROUPS,
  buildAiAdminGuideDiagrams,
  getAiAdminGuidePanelFromHash,
  type AiAdminGuideCopyValue,
  type AiAdminGuideDiagram,
  type AiAdminGuidePanel,
  type AiAdminGuideScenario,
} from "./ai-admin-guide-content";
import classes from "./ai-admin-guide.module.css";

const SCENARIO_ICONS: Record<
  AiAdminGuideScenario["anchor"],
  { color: string; icon: TablerIcon }
> = {
  assistant: { color: "violet", icon: IconBrain },
  retrieval: { color: "blue", icon: IconSearch },
  "rag-api": { color: "teal", icon: IconDatabase },
  "rag-sync": { color: "cyan", icon: IconRefresh },
  "inbound-mcp": { color: "indigo", icon: IconPlugConnected },
  "outbound-mcp": { color: "orange", icon: IconTool },
};

function getPanelPath(
  location: { pathname: string; search: string },
  panel: AiAdminGuidePanel,
): string {
  const base = `${location.pathname}${location.search}`;
  return panel === "overview" ? base : `${base}#${panel}`;
}

function GuideDiagram({ diagram }: { diagram: AiAdminGuideDiagram }) {
  const { t } = useTranslation();

  return (
    <div className={classes.diagramSurface}>
      <MermaidDiagram
        source={diagram.source}
        accessibleName={t(diagram.labelKey)}
        caption={t(diagram.captionKey)}
        previewTitle={t(diagram.labelKey)}
        expandLabel={t("ai.adminGuide.diagram.expand")}
        invalidLabel={t("ai.adminGuide.diagram.invalid")}
        enablePreview
        scrollOnNarrow
        diagramClassName={classes.guideDiagram}
      />
      <Accordion variant="contained" radius="md" mt="sm">
        <Accordion.Item value="text-alternative">
          <Accordion.Control>
            {t("ai.adminGuide.labels.textAlternative")}
          </Accordion.Control>
          <Accordion.Panel>
            <List size="sm" spacing="xs" withPadding>
              {diagram.textAlternativeKeys.map((key) => (
                <List.Item key={key}>{t(key)}</List.Item>
              ))}
            </List>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={classes.fact}>
      <Text size="xs" c="dimmed" fw={700} tt="uppercase">
        {label}
      </Text>
      <Text size="sm">{children}</Text>
    </div>
  );
}

function CopyValues({ values }: { values: readonly AiAdminGuideCopyValue[] }) {
  const { t } = useTranslation();

  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="sm">
      {values.map((item) => (
        <Card key={item.value} withBorder radius="sm" p="sm">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div className={classes.copyValue}>
              <Text size="xs" c="dimmed">
                {t(
                  item.kind === "route"
                    ? "ai.adminGuide.labels.route"
                    : "ai.adminGuide.labels.environment",
                )}
              </Text>
              <Code>{item.value}</Code>
            </div>
            <CopyTextButton text={item.value} />
          </Group>
        </Card>
      ))}
    </SimpleGrid>
  );
}

function ScenarioPanel({
  scenario,
  diagram,
}: {
  scenario: AiAdminGuideScenario;
  diagram?: AiAdminGuideDiagram;
}) {
  const { t } = useTranslation();
  const iconConfig = SCENARIO_ICONS[scenario.anchor];
  const Icon = iconConfig.icon;
  const key = scenario.contentKey;

  return (
    <section id={scenario.anchor} aria-labelledby={`${scenario.anchor}-title`}>
      <Stack gap="lg">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon
            variant="light"
            color={iconConfig.color}
            radius="md"
            size={42}
          >
            <Icon size={21} stroke={1.8} />
          </ThemeIcon>
          <div className={classes.panelHeading}>
            <Title order={2} size="h3" id={`${scenario.anchor}-title`}>
              {t(scenario.titleKey)}
            </Title>
            <Text c="dimmed" mt={4} maw={820}>
              {t(`${key}.description`)}
            </Text>
          </div>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
          <Fact label={t("ai.adminGuide.labels.owner")}>
            {t(`${key}.owner`)}
          </Fact>
          <Fact label={t("ai.adminGuide.labels.prerequisite")}>
            {t(`${key}.prerequisite`)}
          </Fact>
          <Fact label={t("ai.adminGuide.labels.result")}>
            {t(`${key}.result`)}
          </Fact>
        </SimpleGrid>

        {diagram && <GuideDiagram diagram={diagram} />}

        <div>
          <Title order={3} size="h4" mb="sm">
            {t("ai.adminGuide.labels.steps")}
          </Title>
          <List type="ordered" spacing="sm" withPadding>
            {(scenario.stepKeys ?? ["step1", "step2", "step3"]).map((step) => (
              <List.Item key={step}>{t(`${key}.steps.${step}`)}</List.Item>
            ))}
          </List>
        </div>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Alert color="green" variant="light" icon={<IconCheck size={18} />}>
            <Text fw={700} size="sm" mb={4}>
              {t("ai.adminGuide.labels.success")}
            </Text>
            <Text size="sm">{t(`${key}.success`)}</Text>
          </Alert>
          <Alert color="gray" variant="light" icon={<IconRefresh size={18} />}>
            <Text fw={700} size="sm" mb={4}>
              {t("ai.adminGuide.labels.rollback")}
            </Text>
            <Text size="sm">{t(`${key}.rollback`)}</Text>
          </Alert>
        </SimpleGrid>

        <Button
          component={Link}
          to={scenario.settingsPath}
          variant="light"
          className={classes.primaryAction}
          rightSection={<IconChevronRight size={16} />}
        >
          {t("ai.adminGuide.labels.openSettings")}
        </Button>

        <Accordion variant="contained" radius="md">
          <Accordion.Item value="technical-details">
            <Accordion.Control>
              {t("ai.adminGuide.labels.technicalDetails")}
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm">{t(`${key}.technical`)}</Text>
              <CopyValues values={scenario.controls} />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </section>
  );
}

function OverviewPanel({ diagram }: { diagram: AiAdminGuideDiagram }) {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="ai-guide-overview-title">
      <Stack gap="lg">
        <div>
          <Title order={2} size="h3" id="ai-guide-overview-title">
            {t("ai.adminGuide.overview.title")}
          </Title>
          <Text c="dimmed" mt={4} maw={820}>
            {t("ai.adminGuide.overview.description")}
          </Text>
        </div>
        <GuideDiagram diagram={diagram} />
        <Alert color="blue" variant="light" icon={<IconCheck size={18} />}>
          <Text size="sm">{t("ai.adminGuide.overview.setupSequence")}</Text>
        </Alert>
      </Stack>
    </section>
  );
}

function SecurityPanel() {
  const { t } = useTranslation();

  return (
    <section id="security" aria-labelledby="ai-guide-security-title">
      <Stack gap="lg">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color="blue" radius="md" size={42}>
            <IconShieldCheck size={21} />
          </ThemeIcon>
          <div className={classes.panelHeading}>
            <Title order={2} size="h3" id="ai-guide-security-title">
              {t("ai.adminGuide.security.title")}
            </Title>
            <Text c="dimmed" mt={4} maw={820}>
              {t("ai.adminGuide.security.description")}
            </Text>
          </div>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          {AI_ADMIN_GUIDE_SECURITY_PRINCIPLES.map((principle) => (
            <Card key={principle} withBorder radius="md" p="md">
              <Text fw={700} size="sm">
                {t(`ai.adminGuide.security.principles.${principle}.title`)}
              </Text>
              <Text size="sm" c="dimmed" mt={4}>
                {t(
                  `ai.adminGuide.security.principles.${principle}.description`,
                )}
              </Text>
            </Card>
          ))}
        </SimpleGrid>

        <Accordion variant="contained" radius="md">
          <Accordion.Item value="security-matrix">
            <Accordion.Control>
              {t("ai.adminGuide.security.matrixTitle")}
            </Accordion.Control>
            <Accordion.Panel>
              <Text size="sm" c="dimmed" mb="md">
                {t("ai.adminGuide.security.matrixDescription")}
              </Text>
              <Table.ScrollContainer
                minWidth={680}
                className={responsiveTableClasses.responsiveScroll}
              >
                <Table
                  striped
                  highlightOnHover
                  withTableBorder
                  className={responsiveTableClasses.responsiveTable}
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>
                        {t("ai.adminGuide.security.scenarioLabel")}
                      </Table.Th>
                      <Table.Th>
                        {t("ai.adminGuide.security.ownerLabel")}
                      </Table.Th>
                      <Table.Th>
                        {t("ai.adminGuide.security.boundaryLabel")}
                      </Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {AI_ADMIN_GUIDE_SECURITY_ROWS.map((row) => (
                      <Table.Tr key={row.id}>
                        <Table.Td
                          data-card-role="primary"
                          data-label={t("ai.adminGuide.security.scenarioLabel")}
                        >
                          <Text fw={650} size="sm">
                            {t(row.nameKey)}
                          </Text>
                        </Table.Td>
                        <Table.Td
                          data-label={t("ai.adminGuide.security.ownerLabel")}
                        >
                          <Text size="sm">{t(row.ownerKey)}</Text>
                        </Table.Td>
                        <Table.Td
                          data-label={t("ai.adminGuide.security.boundaryLabel")}
                        >
                          <Text size="sm">{t(row.boundaryKey)}</Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </section>
  );
}

function TroubleshootingPanel() {
  const { t } = useTranslation();

  return (
    <section
      id="troubleshooting"
      aria-labelledby="ai-guide-troubleshooting-title"
    >
      <Stack gap="lg">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color="yellow" radius="md" size={42}>
            <IconAlertTriangle size={21} />
          </ThemeIcon>
          <div className={classes.panelHeading}>
            <Title order={2} size="h3" id="ai-guide-troubleshooting-title">
              {t("ai.adminGuide.troubleshooting.title")}
            </Title>
            <Text c="dimmed" mt={4} maw={820}>
              {t("ai.adminGuide.troubleshooting.description")}
            </Text>
          </div>
        </Group>

        <Accordion multiple variant="separated" radius="md">
          {AI_ADMIN_GUIDE_TROUBLESHOOTING_GROUPS.map((group) => (
            <Accordion.Item key={group.id} value={group.id}>
              <Accordion.Control>
                {t(`ai.adminGuide.troubleshooting.groups.${group.id}`)}
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  {group.rows.map((row) => (
                    <div key={row} className={classes.troubleshootingItem}>
                      <Text fw={700} size="sm">
                        {t(`ai.adminGuide.troubleshooting.rows.${row}.signal`)}
                      </Text>
                      <Text size="sm" c="dimmed" mt={4}>
                        {t(`ai.adminGuide.troubleshooting.rows.${row}.action`)}
                      </Text>
                    </div>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>

        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={18} />}
        >
          <Text size="sm">{t("ai.adminGuide.troubleshooting.recovery")}</Text>
        </Alert>
      </Stack>
    </section>
  );
}

export default function AiAdminGuide() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const activePanel = getAiAdminGuidePanelFromHash(location.hash);
  const diagrams = useMemo(() => buildAiAdminGuideDiagrams(t), [t]);
  const scenario = AI_ADMIN_GUIDE_SCENARIOS.find(
    (item) => item.anchor === activePanel,
  );
  const navigationOptions = [
    {
      value: "overview",
      label: t(AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS.overview),
    },
    ...AI_ADMIN_GUIDE_NAVIGATION_GROUPS.flatMap((group) =>
      group.panels.map((panel) => ({
        value: panel,
        label: t(AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS[panel]),
      })),
    ),
  ];

  return (
    <Stack gap="lg" className={classes.page}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon size={42} radius="md" variant="light" color="violet">
          <IconBook2 size={22} stroke={1.8} />
        </ThemeIcon>
        <div className={classes.panelHeading}>
          <Title order={1} size="h2" id="ai-admin-guide-title">
            {t("ai.adminGuide.title")}
          </Title>
          <Text c="dimmed" mt={4} maw={820}>
            {t("ai.adminGuide.description")}
          </Text>
        </div>
      </Group>

      <Select
        className={classes.mobileNavigation}
        label={t("ai.adminGuide.navigation.selectLabel")}
        data={navigationOptions}
        value={activePanel}
        allowDeselect={false}
        onChange={(value) => {
          if (value) {
            void navigate(getPanelPath(location, value as AiAdminGuidePanel));
          }
        }}
      />

      <div className={classes.layout}>
        <Paper
          component="nav"
          withBorder
          radius="md"
          p="xs"
          className={classes.navigation}
          aria-label={t("ai.adminGuide.navigation.label")}
        >
          <Stack gap="md">
            <Button
              component={Link}
              to={getPanelPath(location, "overview")}
              variant={activePanel === "overview" ? "light" : "subtle"}
              color={activePanel === "overview" ? "blue" : "gray"}
              justify="flex-start"
              aria-current={activePanel === "overview" ? "page" : undefined}
            >
              {t(AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS.overview)}
            </Button>
            {AI_ADMIN_GUIDE_NAVIGATION_GROUPS.map((group) => (
              <div key={group.labelKey}>
                <Text
                  size="xs"
                  c="dimmed"
                  fw={700}
                  tt="uppercase"
                  px="sm"
                  mb={4}
                >
                  {t(group.labelKey)}
                </Text>
                <Stack gap={2}>
                  {group.panels.map((panel) => (
                    <Button
                      key={panel}
                      component={Link}
                      to={getPanelPath(location, panel)}
                      variant={activePanel === panel ? "light" : "subtle"}
                      color={activePanel === panel ? "blue" : "gray"}
                      justify="flex-start"
                      aria-current={activePanel === panel ? "page" : undefined}
                    >
                      {t(AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS[panel])}
                    </Button>
                  ))}
                </Stack>
              </div>
            ))}
          </Stack>
        </Paper>

        <main className={classes.content} aria-live="polite">
          {activePanel === "overview" && (
            <OverviewPanel diagram={diagrams.overview} />
          )}
          {scenario && (
            <ScenarioPanel
              key={scenario.anchor}
              scenario={scenario}
              diagram={
                scenario.diagram ? diagrams[scenario.diagram] : undefined
              }
            />
          )}
          {activePanel === "security" && <SecurityPanel />}
          {activePanel === "troubleshooting" && <TroubleshootingPanel />}
        </main>
      </div>
    </Stack>
  );
}
