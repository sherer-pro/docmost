import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { DEFAULT_AI_QUICK_COMMANDS } from "./quick-commands";

type LocaleModule = {
  default: {
    ai: {
      commandPrompt: Record<string, string>;
    };
  };
};

const localeModules = import.meta.glob<LocaleModule>(
  "../../../../public/locales/*/translation.json",
  { eager: true },
);

function expectFiveInstructionParts(prompt: string, label: string) {
  const instructionLines = prompt.split("\n");
  const renderedPrompt = marked.parse(prompt, { async: false }) as string;

  expect(instructionLines, label).toHaveLength(5);
  expect(
    instructionLines.map((line) => line.match(/^([1-5])\. /)?.[1]),
    label,
  ).toEqual(["1", "2", "3", "4", "5"]);
  expect(renderedPrompt.match(/<li>/g), label).toHaveLength(5);
  expect(prompt, label).not.toMatch(/(?:^|\n)6\. /);
}

describe("default AI quick commands", () => {
  it("defines five Markdown instruction lines for every built-in prompt", () => {
    for (const command of DEFAULT_AI_QUICK_COMMANDS) {
      expectFiveInstructionParts(command.prompt, command.id);
    }
  });

  it("defines five Markdown instruction lines in every locale", () => {
    for (const [localePath, localeModule] of Object.entries(localeModules)) {
      for (const command of DEFAULT_AI_QUICK_COMMANDS) {
        expectFiveInstructionParts(
          localeModule.default.ai.commandPrompt[command.id],
          `${localePath}:${command.id}`,
        );
      }
    }
  });
});
