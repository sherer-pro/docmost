import { describe, expect, it } from 'vitest';
import { SpaceRole, UserRole } from '@/lib/types.ts';
import {
  canExportDocument,
  hasFullSpaceAccess,
} from './export-access';

describe('export access', () => {
  it.each([UserRole.OWNER, UserRole.ADMIN])(
    'grants full space access to workspace role %s',
    (workspaceRole) => {
      expect(hasFullSpaceAccess({ workspaceRole })).toBe(true);
    },
  );

  it('grants full space access to a space admin', () => {
    expect(
      hasFullSpaceAccess({
        workspaceRole: UserRole.MEMBER,
        spaceRole: SpaceRole.ADMIN,
      }),
    ).toBe(true);
  });

  it.each([SpaceRole.WRITER, SpaceRole.READER, undefined])(
    'rejects non-admin space role %s',
    (spaceRole) => {
      expect(
        hasFullSpaceAccess({
          workspaceRole: UserRole.MEMBER,
          spaceRole,
        }),
      ).toBe(false);
    },
  );

  it('requires full space access for a top-level document', () => {
    expect(
      canExportDocument({
        parentPageId: null,
        workspaceRole: UserRole.MEMBER,
        spaceRole: SpaceRole.WRITER,
      }),
    ).toBe(false);
    expect(
      canExportDocument({
        parentPageId: null,
        workspaceRole: UserRole.ADMIN,
        spaceRole: SpaceRole.READER,
      }),
    ).toBe(true);
    expect(
      canExportDocument({
        parentPageId: null,
        fullSpaceAccess: true,
      }),
    ).toBe(true);
  });

  it('keeps nested document export available', () => {
    expect(
      canExportDocument({
        parentPageId: 'parent-page',
        workspaceRole: UserRole.MEMBER,
        spaceRole: SpaceRole.READER,
      }),
    ).toBe(true);
  });

  it('does not expose export before the document hierarchy is known', () => {
    expect(
      canExportDocument({
        parentPageId: undefined,
        workspaceRole: UserRole.ADMIN,
      }),
    ).toBe(false);
  });
});
