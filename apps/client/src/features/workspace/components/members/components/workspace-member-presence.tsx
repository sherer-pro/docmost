import {
  Anchor,
  Badge,
  Box,
  Button,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconCircle,
  IconDevices,
  IconExternalLink,
  IconFileText,
  IconFolder,
  IconWorld,
} from "@tabler/icons-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formattedDate } from "@/lib/time";
import {
  MemberPresence,
  MemberPresenceLocation,
  MemberPresenceSession,
} from "@/features/workspace/types/workspace.types";
import { getMemberPresenceSummary } from "./workspace-member-presence-utils";

export function MemberPresenceCell({
  expanded,
  onToggle,
  presence,
}: {
  expanded: boolean;
  onToggle: () => void;
  presence: MemberPresence | undefined;
}) {
  const { t } = useTranslation();
  const isOnline = Boolean(presence?.isOnline && presence.sessions.length > 0);

  if (!isOnline) {
    return (
      <Group gap={6} wrap="nowrap">
        <IconCircle size={8} fill="currentColor" color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          {t("Offline")}
        </Text>
      </Group>
    );
  }

  return (
    <Button
      aria-expanded={expanded}
      onClick={onToggle}
      size="compact-sm"
      variant="subtle"
      color="green"
      px={4}
      style={{ maxWidth: "100%", minHeight: 32 }}
    >
      <Group gap={6} wrap="nowrap">
        <IconCircle size={8} fill="currentColor" />
        <Text size="sm" fw={500} truncate="end">
          {getMemberPresenceSummary(presence, t)}
        </Text>
      </Group>
    </Button>
  );
}

export function MemberPresenceDetails({
  sessions,
}: {
  sessions: MemberPresenceSession[];
}) {
  return (
    <Stack gap="sm">
      {sessions.map((session) => (
        <SessionPresenceDetails key={session.sessionKey} session={session} />
      ))}
    </Stack>
  );
}

function SessionPresenceDetails({ session }: { session: MemberPresenceSession }) {
  const { t } = useTranslation();

  return (
    <Box>
      <Group gap="xs" wrap="nowrap" mb={6}>
        <IconDevices size={16} stroke={1.7} />
        <Text size="sm" fw={500} lineClamp={1}>
          {session.deviceName || t("Unknown device")}
        </Text>
        {session.isLegacy && (
          <Badge size="xs" variant="light" color="gray">
            {t("Unknown session")}
          </Badge>
        )}
        <Text size="xs" c="dimmed" ml="auto">
          {formattedDate(new Date(session.lastSeenAt))}
        </Text>
      </Group>

      <Group gap={6}>
        {session.locations.map((location) => (
          <LocationBadge key={getLocationKey(location)} location={location} />
        ))}
      </Group>
    </Box>
  );
}

function LocationBadge({ location }: { location: MemberPresenceLocation }) {
  const { t } = useTranslation();
  const icon = getLocationIcon(location.type);
  const label = getLocationLabel(location, t);

  const badge = (
    <Badge
      leftSection={icon}
      rightSection={location.path ? <IconExternalLink size={12} /> : undefined}
      variant="light"
      color={getLocationColor(location.type)}
      maw={280}
    >
      <Text component="span" size="xs" truncate="end">
        {label}
      </Text>
    </Badge>
  );

  if (!location.path) {
    return badge;
  }

  return (
    <Anchor component={Link} to={location.path} underline="never">
      {badge}
    </Anchor>
  );
}

function getLocationIcon(type: MemberPresenceLocation["type"]) {
  if (type === "page") {
    return <IconFileText size={12} />;
  }

  if (type === "space") {
    return <IconFolder size={12} />;
  }

  return <IconWorld size={12} />;
}

function getLocationColor(type: MemberPresenceLocation["type"]) {
  if (type === "page") {
    return "blue";
  }

  if (type === "space") {
    return "violet";
  }

  return "gray";
}

function getLocationLabel(
  location: MemberPresenceLocation,
  t: (key: string) => string,
) {
  if (location.type === "workspace") {
    return t(location.title);
  }

  if (location.type === "page" && location.spaceName) {
    return `${location.title} · ${location.spaceName}`;
  }

  return location.title;
}

function getLocationKey(location: MemberPresenceLocation) {
  return [
    location.type,
    location.pageId ?? "",
    location.spaceId ?? "",
    location.path ?? "",
  ].join(":");
}
