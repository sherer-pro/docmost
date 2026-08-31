import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(resolve(process.cwd(), "src", "main.tsx"), "utf8");
const colorSchemeSource = readFileSync(
  resolve(process.cwd(), "src", "styles", "theme-color-scheme.css"),
  "utf8",
);

describe("theme color scheme contract", () => {
  it("loads the browser override after Mantine global styles", () => {
    const mantineStyles = mainSource.indexOf(
      'import "@mantine/core/styles.css";',
    );
    const colorSchemeStyles = mainSource.indexOf(
      'import "@/styles/theme-color-scheme.css";',
    );

    expect(mantineStyles).toBeGreaterThanOrEqual(0);
    expect(colorSchemeStyles).toBeGreaterThan(mantineStyles);
  });

  it("prevents the browser from overriding the selected color scheme", () => {
    expect(colorSchemeSource).toMatch(
      /:root\[data-mantine-color-scheme="light"\]\s*{\s*color-scheme:\s*only light;/,
    );
    expect(colorSchemeSource).toMatch(
      /:root\[data-mantine-color-scheme="dark"\]\s*{\s*color-scheme:\s*only dark;/,
    );
  });
});
