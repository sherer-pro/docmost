import { AiQuickCommand } from "@/features/ai/types/ai.types.ts";

export type BuiltInAiQuickCommand = AiQuickCommand & {
  translationKey: string;
  promptTranslationKey: string;
  descriptionTranslationKey: string;
};

export const DEFAULT_AI_QUICK_COMMANDS: BuiltInAiQuickCommand[] = [
  {
    id: "summarize",
    label: "Summarize",
    translationKey: "ai.commandSummarize",
    promptTranslationKey: "ai.commandPrompt.summarize",
    descriptionTranslationKey: "ai.commandDescription.summarize",
    prompt:
      "1) Identify the main message and key facts. 2) Condense them into a concise summary. 3) Preserve important names, numbers, and qualifications. 4) Remove repetition and minor detail without adding new information. 5) Return only the summary in the original language.",
    description: "Creates a concise summary of the selected context.",
    enabled: true,
    position: 0,
  },
  {
    id: "shorten",
    label: "Shorten",
    translationKey: "ai.commandShorten",
    promptTranslationKey: "ai.commandPrompt.shorten",
    descriptionTranslationKey: "ai.commandDescription.shorten",
    prompt:
      "1) Reduce the length substantially. 2) Preserve the original meaning and key facts. 3) Remove repetition, filler, and redundant examples. 4) Keep the original tone, language, and essential formatting. 5) Return only the shortened text.",
    description: "Makes the text shorter without losing its meaning.",
    enabled: true,
    position: 1,
  },
  {
    id: "explain",
    label: "Explain",
    translationKey: "ai.commandExplain",
    promptTranslationKey: "ai.commandPrompt.explain",
    descriptionTranslationKey: "ai.commandDescription.explain",
    prompt:
      "1) Identify the main concepts and their relationships. 2) Explain them in plain language for a non-expert. 3) Define necessary jargon and add a brief example when useful. 4) Preserve accuracy and state uncertainty instead of inventing details. 5) Return only the explanation.",
    description: "Explains the text in clear, accessible language.",
    enabled: true,
    position: 2,
  },
  {
    id: "improve",
    label: "Improve",
    translationKey: "ai.commandImprove",
    promptTranslationKey: "ai.commandPrompt.improve",
    descriptionTranslationKey: "ai.commandDescription.improve",
    prompt:
      "1) Preserve the original intent and facts. 2) Improve clarity, flow, and structure. 3) Replace vague or awkward phrasing and strengthen transitions. 4) Keep the original language, tone, and formatting unless a change is necessary. 5) Return only the improved text.",
    description: "Improves clarity, flow, and structure.",
    enabled: true,
    position: 3,
  },
  {
    id: "grammar",
    label: "Fix grammar",
    translationKey: "ai.commandGrammar",
    promptTranslationKey: "ai.commandPrompt.grammar",
    descriptionTranslationKey: "ai.commandDescription.grammar",
    prompt:
      "1) Correct grammar, spelling, and punctuation. 2) Fix agreement, word forms, and typographical errors. 3) Preserve the original meaning, voice, terminology, and formatting. 4) Do not add or remove factual content. 5) Return only the corrected text.",
    description: "Corrects grammar, spelling, and punctuation.",
    enabled: true,
    position: 4,
  },
  {
    id: "expand",
    label: "Expand",
    translationKey: "ai.commandExpand",
    promptTranslationKey: "ai.commandPrompt.expand",
    descriptionTranslationKey: "ai.commandDescription.expand",
    prompt:
      "1) Preserve the main idea, intent, and tone. 2) Add relevant explanations, context, or examples. 3) Develop incomplete ideas and connect them with clear transitions. 4) Do not invent unverifiable facts or add filler. 5) Return only the expanded text.",
    description: "Adds useful detail while keeping the original intent.",
    enabled: true,
    position: 5,
  },
  {
    id: "continue",
    label: "Continue",
    translationKey: "ai.commandContinue",
    promptTranslationKey: "ai.commandPrompt.continue",
    descriptionTranslationKey: "ai.commandDescription.continue",
    prompt:
      "1) Infer the document's style, voice, format, and direction. 2) Continue seamlessly from the ending without repeating existing text. 3) Develop the next logical point with a consistent level of detail. 4) Do not introduce unsupported facts or an abrupt conclusion. 5) Return only the continuation.",
    description: "Continues writing in the style of the current document.",
    enabled: true,
    position: 6,
  },
  {
    id: "tone",
    label: "Change tone",
    translationKey: "ai.commandTone",
    promptTranslationKey: "ai.commandPrompt.tone",
    descriptionTranslationKey: "ai.commandDescription.tone",
    prompt:
      "1) Preserve the original meaning and factual content. 2) Use a clear, professional, confident, and respectful tone. 3) Improve vocabulary, sentence rhythm, and transitions. 4) Avoid jargon, clichés, exaggeration, and unnecessary formality. 5) Return only the rewritten text.",
    description: "Rewrites the text in a clear professional tone.",
    enabled: true,
    position: 7,
  },
  {
    id: "translate",
    label: "Translate",
    translationKey: "ai.commandTranslate",
    promptTranslationKey: "ai.commandPrompt.translate",
    descriptionTranslationKey: "ai.commandDescription.translate",
    prompt:
      "1) Determine the source meaning, context, and tone. 2) Translate into the requested language; if none is specified, use the language of this instruction. 3) Preserve names, numbers, formatting, and established terminology. 4) Prefer natural phrasing over word-for-word translation without adding information. 5) Return only the translation.",
    description: "Translates the text into the requested language.",
    enabled: true,
    position: 8,
  },
];
