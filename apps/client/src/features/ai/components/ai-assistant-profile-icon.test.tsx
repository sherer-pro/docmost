import { AI_ASSISTANT_PROFILE_ICONS } from "@docmost/api-contract";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiAssistantProfileIcon } from "./ai-assistant-profile-icon.tsx";

describe("AiAssistantProfileIcon", () => {
  it("renders every curated icon as a decorative SVG", () => {
    const markup = AI_ASSISTANT_PROFILE_ICONS.map((icon) =>
      renderToStaticMarkup(<AiAssistantProfileIcon icon={icon} size={24} />),
    );

    expect(AI_ASSISTANT_PROFILE_ICONS).toHaveLength(32);
    expect(markup).toHaveLength(32);
    for (const iconMarkup of markup) {
      expect(iconMarkup).toContain("<svg");
      expect(iconMarkup).toContain('aria-hidden="true"');
    }
  });
});
