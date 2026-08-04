import { SpacePolicyService } from './space-policy.service';

describe('SpacePolicyService', () => {
  const service = new SpacePolicyService({} as any);

  const cases = [
    { workspace: false, override: null, expected: false },
    { workspace: false, override: false, expected: false },
    { workspace: false, override: true, expected: true },
    { workspace: true, override: null, expected: true },
    { workspace: true, override: false, expected: false },
    { workspace: true, override: true, expected: true },
  ] as const;

  describe.each([
    ['enforceMfa', 'security', 'enforceMfa'],
    ['enforceSso', 'security', 'enforceSso'],
    ['disablePublicSharing', 'sharing', 'disabled'],
  ] as const)('%s override resolution', (policyKey, section, settingKey) => {
    it.each(cases)(
      'resolves workspace=$workspace override=$override',
      ({ workspace, override, expected }) => {
        const workspaceSource = {
          enforceMfa: policyKey === 'enforceMfa' ? workspace : false,
          enforceSso: policyKey === 'enforceSso' ? workspace : false,
          settings:
            policyKey === 'disablePublicSharing'
              ? { sharing: { disabled: workspace } }
              : {},
        } as any;
        const spaceSettings =
          override === null
            ? {}
            : { [section]: { [settingKey]: override } };

        const policy = service.resolveFromSettings(
          workspaceSource,
          spaceSettings,
        );

        expect(policy.overrides[policyKey]).toBe(override);
        expect(policy.effective[policyKey]).toBe(expected);
      },
    );
  });

  it('treats non-boolean stored values as inheritance', () => {
    const policy = service.resolveFromSettings(
      { enforceMfa: true, enforceSso: false, settings: {} } as any,
      {
        security: { enforceMfa: 'true', enforceSso: 1 },
        sharing: { disabled: 'false' },
      },
    );

    expect(policy.overrides).toEqual({
      enforceMfa: null,
      enforceSso: null,
      disablePublicSharing: null,
    });
    expect(policy.effective).toEqual({
      enforceMfa: true,
      enforceSso: false,
      disablePublicSharing: false,
    });
  });

  it('detects any transition that weakens an effective policy', () => {
    const strict = {
      enforceMfa: true,
      enforceSso: true,
      disablePublicSharing: true,
    };

    expect(service.isLoosening(strict, strict)).toBe(false);
    expect(
      service.isLoosening(strict, { ...strict, enforceMfa: false }),
    ).toBe(true);
    expect(
      service.isLoosening(strict, { ...strict, enforceSso: false }),
    ).toBe(true);
    expect(
      service.isLoosening(strict, {
        ...strict,
        disablePublicSharing: false,
      }),
    ).toBe(true);
  });
});
