const WORKSPACE_HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,23}[a-z0-9])?$/;

export function normalizeHostHeader(
  hostHeader?: string | string[] | null,
): string | null {
  if (!hostHeader || Array.isArray(hostHeader)) {
    return null;
  }

  const rawHost = hostHeader.trim().toLowerCase().replace(/\.+$/, '');
  if (
    !rawHost ||
    rawHost.includes('/') ||
    rawHost.includes('\\') ||
    rawHost.includes('@') ||
    /\s/.test(rawHost)
  ) {
    return null;
  }

  try {
    const hostName = new URL(`http://${rawHost}`).hostname
      .toLowerCase()
      .replace(/\.+$/, '');

    return hostName || null;
  } catch {
    return null;
  }
}

export function normalizeConfiguredDomain(domain?: string | null): string | null {
  const normalized = normalizeHostHeader(domain);
  return normalized && normalized.includes('.') ? normalized : null;
}

export function isValidWorkspaceHostname(hostname: string): boolean {
  return WORKSPACE_HOSTNAME_PATTERN.test(hostname);
}

export function getWorkspaceHostnameFromCloudHost(
  hostHeader: string | string[] | undefined,
  subdomainHost: string | undefined,
): string | null {
  const host = normalizeHostHeader(hostHeader);
  const rootDomain = normalizeConfiguredDomain(subdomainHost);

  if (!host || !rootDomain || host === rootDomain) {
    return null;
  }

  const suffix = `.${rootDomain}`;
  if (!host.endsWith(suffix)) {
    return null;
  }

  const workspaceHostname = host.slice(0, -suffix.length);
  if (
    !workspaceHostname ||
    workspaceHostname.includes('.') ||
    !isValidWorkspaceHostname(workspaceHostname)
  ) {
    return null;
  }

  return workspaceHostname;
}
