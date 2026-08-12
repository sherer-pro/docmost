import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  Group,
  List,
  ScrollArea,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import CopyTextButton from "@/components/common/copy";
import responsiveTableClasses from "@/components/ui/responsive-table.module.css";
import { MermaidDiagram } from "@/features/editor/components/common/mermaid-diagram";
import {
  AI_ADMIN_GUIDE_ANCHORS,
  AI_ADMIN_GUIDE_CONTRACT_VERSION,
  AI_ADMIN_GUIDE_COPY_VALUES,
  AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS,
  AI_ADMIN_GUIDE_SCENARIOS,
  AI_ADMIN_GUIDE_SECURITY_ROWS,
  AI_ADMIN_GUIDE_TROUBLESHOOTING_ROWS,
  buildAiAdminGuideDiagrams,
  getAiAdminGuideAnchorFromHash,
  splitAiAdminGuideFields,
  type AiAdminGuideDiagram,
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

function splitSteps(value: string): string[] {
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function GuideDiagram({
  diagram,
  onRenderComplete,
}: {
  diagram: AiAdminGuideDiagram;
  onRenderComplete: () => void;
}) {
  const { t } = useTranslation();
  const steps = splitSteps(t(diagram.textAlternativeKey));

  return (
    <Card withBorder radius="md" p="md" className={classes.diagramCard}>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <MermaidDiagram
          source={diagram.source}
          accessibleName={t(diagram.labelKey)}
          caption={t(diagram.captionKey)}
          previewTitle={t(diagram.labelKey)}
          expandLabel={t("ai.adminGuide.diagram.expand")}
          invalidLabel={t("ai.adminGuide.diagram.invalid")}
          enablePreview
          scrollOnNarrow
          onRenderComplete={onRenderComplete}
        />
        <div>
          <Text fw={650} size="sm" mb="xs">
            {t("ai.adminGuide.diagram.stepsTitle")}
          </Text>
          <List size="sm" spacing="xs" withPadding>
            {steps.map((step) => (
              <List.Item key={step}>{step}</List.Item>
            ))}
          </List>
        </div>
      </SimpleGrid>
    </Card>
  );
}

function ScenarioTaskCard({ scenario }: { scenario: AiAdminGuideScenario }) {
  const { t } = useTranslation();
  const iconConfig = SCENARIO_ICONS[scenario.anchor];
  const Icon = iconConfig.icon;
  const [role, prerequisite, result] = splitAiAdminGuideFields(
    t(scenario.factsKey),
    3,
  );

  return (
    <Card withBorder radius="md" p="md" className={classes.taskCard}>
      <Stack gap="sm" h="100%">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon
            variant="light"
            color={iconConfig.color}
            radius="md"
            size="lg"
          >
            <Icon size={19} stroke={1.9} />
          </ThemeIcon>
          <Text fw={700}>{t(scenario.titleKey)}</Text>
        </Group>
        <div className={classes.taskFacts}>
          <Text size="xs" c="dimmed" fw={650}>
            {t("ai.adminGuide.roleLabel")}
          </Text>
          <Text size="sm">{role}</Text>
          <Text size="xs" c="dimmed" fw={650}>
            {t("ai.adminGuide.prerequisiteLabel")}
          </Text>
          <Text size="sm">{prerequisite}</Text>
          <Text size="xs" c="dimmed" fw={650}>
            {t("ai.adminGuide.resultLabel")}
          </Text>
          <Text size="sm">{result}</Text>
        </div>
        <Group mt="auto" justify="space-between" gap="xs">
          <Anchor href={`#${scenario.anchor}`} size="sm">
            {t("ai.adminGuide.detailsLabel")}
          </Anchor>
          <Button
            component={Link}
            to={scenario.settingsPath}
            size="xs"
            variant="light"
            rightSection={<IconChevronRight size={14} />}
          >
            {t("ai.adminGuide.openSettings")}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

function InstructionBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={classes.instructionBlock}>
      <Text size="xs" c="dimmed" fw={700} tt="uppercase">
        {title}
      </Text>
      <div>{children}</div>
    </div>
  );
}

function ScenarioSection({
  scenario,
  diagram,
  activeAnchor,
  onDiagramRenderComplete,
}: {
  scenario: AiAdminGuideScenario;
  diagram?: AiAdminGuideDiagram;
  activeAnchor: string | null;
  onDiagramRenderComplete: () => void;
}) {
  const { t } = useTranslation();
  const [opened, setOpened] = useState(activeAnchor === scenario.anchor);
  const iconConfig = SCENARIO_ICONS[scenario.anchor];
  const Icon = iconConfig.icon;
  const [stepsValue, success, rollback] = splitAiAdminGuideFields(
    t(scenario.operationsKey),
    3,
  );

  useEffect(() => {
    if (activeAnchor === scenario.anchor) {
      setOpened(true);
    }
  }, [activeAnchor, scenario.anchor]);

  return (
    <section
      id={scenario.anchor}
      aria-labelledby={`${scenario.anchor}-title`}
      className={classes.anchorSection}
    >
      <Card withBorder radius="lg" p={{ base: "md", sm: "lg" }}>
        <Stack gap="md">
          <Group gap="sm" wrap="nowrap" align="flex-start">
            <ThemeIcon
              variant="light"
              color={iconConfig.color}
              radius="md"
              size="lg"
            >
              <Icon size={19} />
            </ThemeIcon>
            <div>
              <Title order={3} size="h4" id={`${scenario.anchor}-title`}>
                {t(scenario.titleKey)}
              </Title>
              <Text size="sm" c="dimmed" mt={4} maw={920}>
                {t(scenario.descriptionKey)}
              </Text>
            </div>
          </Group>

          {diagram && (
            <GuideDiagram
              diagram={diagram}
              onRenderComplete={onDiagramRenderComplete}
            />
          )}

          <Accordion
            value={opened ? "instructions" : null}
            onChange={(value) => setOpened(value === "instructions")}
            variant="contained"
            radius="md"
          >
            <Accordion.Item value="instructions">
              <Accordion.Control>
                {t("ai.adminGuide.instructionsTitle")}
              </Accordion.Control>
              <Accordion.Panel>
                <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                  <InstructionBlock title={t("ai.adminGuide.stepsTitle")}>
                    <List size="sm" spacing="xs" withPadding>
                      {splitSteps(stepsValue).map((step) => (
                        <List.Item key={step}>{step}</List.Item>
                      ))}
                    </List>
                  </InstructionBlock>
                  <InstructionBlock title={t("ai.adminGuide.successTitle")}>
                    <Text size="sm">{success}</Text>
                  </InstructionBlock>
                  <InstructionBlock title={t("ai.adminGuide.rollbackTitle")}>
                    <Text size="sm">{rollback}</Text>
                  </InstructionBlock>
                </SimpleGrid>
                <Button
                  component={Link}
                  to={scenario.settingsPath}
                  variant="light"
                  mt="md"
                  rightSection={<IconChevronRight size={16} />}
                >
                  {t("ai.adminGuide.openSettings")}
                </Button>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </Card>
    </section>
  );
}

export default function AiAdminGuide() {
  const { t } = useTranslation();
  const location = useLocation();
  const activeAnchor = getAiAdminGuideAnchorFromHash(location.hash);
  const diagrams = useMemo(() => buildAiAdminGuideDiagrams(t), [t]);
  const [diagramLayoutRevision, setDiagramLayoutRevision] = useState(0);
  const handleDiagramRenderComplete = useCallback(() => {
    setDiagramLayoutRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (!activeAnchor) {
      return;
    }

    window.requestAnimationFrame(() => {
      document.getElementById(activeAnchor)?.scrollIntoView({ block: "start" });
    });
  }, [activeAnchor, diagramLayoutRevision]);

  return (
    <Stack gap="xl">
      <Card withBorder radius="lg" className={classes.hero}>
        <Group wrap="nowrap" align="flex-start">
          <ThemeIcon size={48} radius="md" variant="light" color="violet">
            <IconBook2 size={26} stroke={1.8} />
          </ThemeIcon>
          <div className={classes.heroContent}>
            <Group gap="xs" align="center">
              <Title order={2} size="h3" id="ai-admin-guide-title">
                {t("ai.adminGuide.title")}
              </Title>
              <Badge variant="light" color="gray">
                {t("ai.adminGuide.contractVersion", {
                  version: AI_ADMIN_GUIDE_CONTRACT_VERSION,
                })}
              </Badge>
            </Group>
            <Text c="dimmed" mt={4} maw={880}>
              {t("ai.adminGuide.description")}
            </Text>
          </div>
        </Group>
      </Card>

      <Card
        component="nav"
        withBorder
        radius="md"
        p="md"
        aria-label={t("ai.adminGuide.quickNavLabel")}
      >
        <Group gap="xs">
          {AI_ADMIN_GUIDE_ANCHORS.map((anchor) => (
            <Anchor
              key={anchor}
              href={`#${anchor}`}
              className={classes.navLink}
              aria-current={activeAnchor === anchor ? "location" : undefined}
            >
              {t(AI_ADMIN_GUIDE_NAVIGATION_LABEL_KEYS[anchor])}
            </Anchor>
          ))}
        </Group>
      </Card>

      <section aria-labelledby="ai-guide-task-title">
        <Title order={3} size="h4" id="ai-guide-task-title">
          {t("ai.adminGuide.taskChooserTitle")}
        </Title>
        <Text size="sm" c="dimmed" mt={4} mb="md">
          {t("ai.adminGuide.taskChooserDescription")}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2, xl: 3 }} spacing="md">
          {AI_ADMIN_GUIDE_SCENARIOS.map((scenario) => (
            <ScenarioTaskCard key={scenario.anchor} scenario={scenario} />
          ))}
        </SimpleGrid>
        <Alert
          color="blue"
          variant="light"
          icon={<IconChecklist size={19} />}
          mt="md"
        >
          <Text size="sm">{t("ai.adminGuide.setupSequence")}</Text>
        </Alert>
      </section>

      <section aria-labelledby="ai-guide-architecture-title">
        <Title order={3} size="h4" id="ai-guide-architecture-title">
          {t("ai.adminGuide.architectureTitle")}
        </Title>
        <Text size="sm" c="dimmed" mt={4} mb="md">
          {t("ai.adminGuide.architectureDescription")}
        </Text>
        <GuideDiagram
          diagram={diagrams.overview}
          onRenderComplete={handleDiagramRenderComplete}
        />
      </section>

      {AI_ADMIN_GUIDE_SCENARIOS.map((scenario) => (
        <ScenarioSection
          key={scenario.anchor}
          scenario={scenario}
          activeAnchor={activeAnchor}
          onDiagramRenderComplete={handleDiagramRenderComplete}
          diagram={
            scenario.anchor === "rag-api"
              ? diagrams.rag
              : scenario.anchor === "inbound-mcp"
                ? diagrams.inboundMcp
                : scenario.anchor === "outbound-mcp"
                  ? diagrams.outboundMcp
                  : undefined
          }
        />
      ))}

      <section
        id="security"
        aria-labelledby="ai-guide-security-title"
        className={classes.anchorSection}
      >
        <Group gap="sm" mb={4}>
          <ThemeIcon variant="light" color="blue" radius="md">
            <IconShieldCheck size={18} />
          </ThemeIcon>
          <Title order={3} size="h4" id="ai-guide-security-title">
            {t("ai.adminGuide.securityMatrixTitle")}
          </Title>
        </Group>
        <Text size="sm" c="dimmed" mb="md" maw={920}>
          {t("ai.adminGuide.securityMatrixDescription")}
        </Text>
        <Table.ScrollContainer
          minWidth={720}
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
                <Table.Th>{t("ai.adminGuide.securityScenarioLabel")}</Table.Th>
                <Table.Th>{t("ai.adminGuide.securityOwnerLabel")}</Table.Th>
                <Table.Th>{t("ai.adminGuide.securityBoundaryLabel")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {AI_ADMIN_GUIDE_SECURITY_ROWS.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td
                    data-card-role="primary"
                    data-label={t("ai.adminGuide.securityScenarioLabel")}
                  >
                    <Text fw={650} size="sm">
                      {t(row.nameKey)}
                    </Text>
                  </Table.Td>
                  <Table.Td data-label={t("ai.adminGuide.securityOwnerLabel")}>
                    <Text size="sm">{t(row.ownerKey)}</Text>
                  </Table.Td>
                  <Table.Td
                    data-label={t("ai.adminGuide.securityBoundaryLabel")}
                  >
                    <Text size="sm">{t(row.boundaryKey)}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Alert
          color="orange"
          variant="light"
          icon={<IconShieldCheck size={18} />}
          mt="md"
        >
          <Stack gap={4}>
            <Text size="sm">{t("ai.adminGuide.securityOutboundGroups")}</Text>
            <Text size="sm">{t("ai.adminGuide.securityOutboundConsent")}</Text>
          </Stack>
        </Alert>
      </section>

      <section aria-labelledby="ai-guide-reference-title">
        <Title order={3} size="h4" id="ai-guide-reference-title">
          {t("ai.adminGuide.referencesTitle")}
        </Title>
        <Text size="sm" c="dimmed" mt={4} mb="md">
          {t("ai.adminGuide.referencesDescription")}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
          {AI_ADMIN_GUIDE_COPY_VALUES.map((item) => (
            <Card key={item.value} withBorder radius="sm" p="sm">
              <Group justify="space-between" wrap="nowrap">
                <div className={classes.copyValue}>
                  <Text size="xs" c="dimmed">
                    {t(
                      item.kind === "route"
                        ? "ai.adminGuide.routeLabel"
                        : "ai.adminGuide.environmentLabel",
                    )}
                  </Text>
                  <Code>{item.value}</Code>
                </div>
                <CopyTextButton text={item.value} />
              </Group>
            </Card>
          ))}
        </SimpleGrid>
      </section>

      <section
        id="troubleshooting"
        aria-labelledby="ai-guide-troubleshooting-title"
        className={classes.anchorSection}
      >
        <Group gap="sm" mb={4}>
          <ThemeIcon variant="light" color="yellow" radius="md">
            <IconAlertTriangle size={18} />
          </ThemeIcon>
          <Title order={3} size="h4" id="ai-guide-troubleshooting-title">
            {t("ai.adminGuide.troubleshootingTitle")}
          </Title>
        </Group>
        <Text size="sm" c="dimmed" mb="md" maw={920}>
          {t("ai.adminGuide.troubleshootingDescription")}
        </Text>
        <ScrollArea className={responsiveTableClasses.responsiveScroll}>
          <Table
            withTableBorder
            className={responsiveTableClasses.responsiveTable}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("ai.adminGuide.problemLabel")}</Table.Th>
                <Table.Th>{t("ai.adminGuide.actionLabel")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {AI_ADMIN_GUIDE_TROUBLESHOOTING_ROWS.map((row) => (
                <Table.Tr key={row}>
                  <Table.Td
                    data-card-role="primary"
                    data-label={t("ai.adminGuide.problemLabel")}
                  >
                    <Text fw={650} size="sm">
                      {
                        splitAiAdminGuideFields(
                          t(`ai.adminGuide.troubleshooting.${row}`),
                          2,
                        )[0]
                      }
                    </Text>
                  </Table.Td>
                  <Table.Td data-label={t("ai.adminGuide.actionLabel")}>
                    <Text size="sm">
                      {
                        splitAiAdminGuideFields(
                          t(`ai.adminGuide.troubleshooting.${row}`),
                          2,
                        )[1]
                      }
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>

        <Alert
          color="yellow"
          variant="light"
          icon={<IconAlertTriangle size={20} />}
          title={t("ai.adminGuide.riskTitle")}
          mt="md"
        >
          <Text size="sm">{t("ai.adminGuide.operationsRecovery")}</Text>
        </Alert>
      </section>
    </Stack>
  );
}
