import type { AiAssistantProfileIcon as AiAssistantProfileIconName } from "@docmost/api-contract";
import {
  IconBook,
  IconBrain,
  IconBriefcase,
  IconBuilding,
  IconBulb,
  IconCalculator,
  IconCalendar,
  IconCamera,
  IconChartBar,
  IconCode,
  IconDatabase,
  IconFileText,
  IconHeart,
  IconLanguage,
  IconLeaf,
  IconMail,
  IconMessages,
  IconMicroscope,
  IconMusic,
  IconPalette,
  IconPencil,
  IconPuzzle,
  IconRobot,
  IconRocket,
  IconScale,
  IconSchool,
  IconSearch,
  IconShield,
  IconSparkles,
  IconStethoscope,
  IconTarget,
  IconWorld,
  type Icon as TablerIcon,
} from "@tabler/icons-react";

const PROFILE_ICON_COMPONENTS: Record<AiAssistantProfileIconName, TablerIcon> =
  {
    sparkles: IconSparkles,
    robot: IconRobot,
    brain: IconBrain,
    book: IconBook,
    briefcase: IconBriefcase,
    code: IconCode,
    language: IconLanguage,
    search: IconSearch,
    messages: IconMessages,
    pencil: IconPencil,
    bulb: IconBulb,
    school: IconSchool,
    microscope: IconMicroscope,
    chart: IconChartBar,
    calculator: IconCalculator,
    palette: IconPalette,
    camera: IconCamera,
    music: IconMusic,
    heart: IconHeart,
    shield: IconShield,
    scale: IconScale,
    building: IconBuilding,
    stethoscope: IconStethoscope,
    leaf: IconLeaf,
    world: IconWorld,
    rocket: IconRocket,
    target: IconTarget,
    puzzle: IconPuzzle,
    database: IconDatabase,
    document: IconFileText,
    calendar: IconCalendar,
    mail: IconMail,
  };

export function AiAssistantProfileIcon({
  icon,
  size,
}: {
  icon: AiAssistantProfileIconName;
  size: number;
}) {
  const Icon = PROFILE_ICON_COMPONENTS[icon];
  return <Icon size={size} aria-hidden />;
}
