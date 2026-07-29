import { AiQuickCommand } from "@/features/ai/types/ai.types.ts";

export type BuiltInAiQuickCommand = AiQuickCommand & {
  translationKey: string;
};

export const DEFAULT_AI_QUICK_COMMANDS: BuiltInAiQuickCommand[] = [
  {
    id: "summarize",
    label: "Summarize",
    translationKey: "ai.commandSummarize",
    prompt: "Summarize this content.",
    enabled: true,
    position: 0,
  },
  {
    id: "shorten",
    label: "Shorten",
    translationKey: "ai.commandShorten",
    prompt: "Shorten this content while preserving its meaning.",
    enabled: true,
    position: 1,
  },
  {
    id: "explain",
    label: "Explain",
    translationKey: "ai.commandExplain",
    prompt: "Explain this content clearly.",
    enabled: true,
    position: 2,
  },
  {
    id: "improve",
    label: "Improve",
    translationKey: "ai.commandImprove",
    prompt: "Improve the clarity and structure of this content.",
    enabled: true,
    position: 3,
  },
  {
    id: "grammar",
    label: "Fix grammar",
    translationKey: "ai.commandGrammar",
    prompt: "Fix grammar, spelling, and punctuation.",
    enabled: true,
    position: 4,
  },
  {
    id: "expand",
    label: "Expand",
    translationKey: "ai.commandExpand",
    prompt: "Expand this content with useful detail.",
    enabled: true,
    position: 5,
  },
  {
    id: "continue",
    label: "Continue",
    translationKey: "ai.commandContinue",
    prompt: "Continue writing from where the document ends.",
    enabled: true,
    position: 6,
  },
  {
    id: "tone",
    label: "Change tone",
    translationKey: "ai.commandTone",
    prompt: "Rewrite this content in a clear, professional tone.",
    enabled: true,
    position: 7,
  },
  {
    id: "translate",
    label: "Translate",
    translationKey: "ai.commandTranslate",
    prompt: "Translate this content into the language I specify.",
    enabled: true,
    position: 8,
  },
];
