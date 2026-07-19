type SettingsContainer = {
  headingNumbering?: {
    enabled?: unknown;
  };
};

function normalizeSettings(settings: unknown): SettingsContainer {
  return settings && typeof settings === 'object'
    ? (settings as SettingsContainer)
    : {};
}

export function resolveHeadingNumberingEnabled(
  spaceSettings: unknown,
): boolean {
  return normalizeSettings(spaceSettings).headingNumbering?.enabled === true;
}
