import { SpaceRole, UserRole } from '@/lib/types.ts';

interface FullSpaceAccessInput {
  workspaceRole?: string | null;
  spaceRole?: SpaceRole | string | null;
}

interface DocumentExportAccessInput extends FullSpaceAccessInput {
  parentPageId?: string | null;
  fullSpaceAccess?: boolean;
}

export function hasFullSpaceAccess({
  workspaceRole,
  spaceRole,
}: FullSpaceAccessInput): boolean {
  return (
    workspaceRole === UserRole.OWNER ||
    workspaceRole === UserRole.ADMIN ||
    spaceRole === SpaceRole.ADMIN
  );
}

export function canExportDocument({
  parentPageId,
  workspaceRole,
  spaceRole,
  fullSpaceAccess,
}: DocumentExportAccessInput): boolean {
  if (typeof parentPageId === 'undefined') {
    return false;
  }

  return (
    parentPageId !== null ||
    fullSpaceAccess === true ||
    hasFullSpaceAccess({ workspaceRole, spaceRole })
  );
}
