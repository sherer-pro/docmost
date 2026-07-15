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
  pageSettings: unknown,
  spaceSettings: unknown,
): boolean {
  const pageValue = normalizeSettings(pageSettings).headingNumbering?.enabled;
  if (typeof pageValue === 'boolean') {
    return pageValue;
  }

  return normalizeSettings(spaceSettings).headingNumbering?.enabled === true;
}
