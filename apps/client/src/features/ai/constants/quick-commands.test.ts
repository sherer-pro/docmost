import { describe, expect, it } from "vitest";
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
  expect(prompt.match(/\b[1-5]\)/g), label).toEqual([
    "1)",
    "2)",
    "3)",
    "4)",
    "5)",
  ]);
  expect(prompt, label).not.toMatch(/\b6\)/);
}

describe("default AI quick commands", () => {
  it("defines five explicit instruction parts for every built-in prompt", () => {
    for (const command of DEFAULT_AI_QUICK_COMMANDS) {
      expectFiveInstructionParts(command.prompt, command.id);
    }
  });

  it("defines five explicit instruction parts in every locale", () => {
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
