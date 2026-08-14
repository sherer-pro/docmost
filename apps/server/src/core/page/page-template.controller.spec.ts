import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import {
  AUTH_POLICY_SCOPE_KEY,
  AuthPolicyScopeMetadata,
} from '../../common/decorators/auth-policy-scope.decorator';
import { UserRole } from '../../common/helpers/types/permission';
import { AuthenticationAssuranceService } from '../space-policy/authentication-assurance.service';
import { SpacePolicyService } from '../space-policy/space-policy.service';
import { PageTemplatePolicyGroupsDto } from './dto/page-template.dto';
import { PageTemplateController } from './page-template.controller';

describe('PageTemplateController policy scopes', () => {
  const spaceId = '019fdaa0-0000-7000-8000-000000000001';
  const user = {
    id: '019fdaa0-0000-7000-8000-000000000002',
    workspaceId: '019fdaa0-0000-7000-8000-000000000003',
    role: UserRole.MEMBER,
  } as any;

  it('lets a member with space Manage Settings list active space groups', async () => {
    const response = { items: [], nextCursor: null };
    const policy = {
      listPolicyGroups: jest.fn().mockResolvedValue(response),
    };
    const ability = {
      cannot: jest.fn().mockReturnValue(false),
    };
    const spaceAbility = {
      createForUser: jest.fn().mockResolvedValue(ability),
    };
    const controller = new PageTemplateController(
      {} as any,
      policy as any,
      spaceAbility as any,
    );
    const dto = new PageTemplatePolicyGroupsDto();

    await expect(controller.listPolicyGroups(spaceId, dto, user)).resolves.toBe(
      response,
    );
    expect(spaceAbility.createForUser).toHaveBeenCalledWith(user, spaceId);
    expect(policy.listPolicyGroups).toHaveBeenCalledWith(
      user.workspaceId,
      spaceId,
      dto,
    );
  });

  it('pins policy and usage routes to their resource assurance scopes', () => {
    const metadata = (method: keyof PageTemplateController) =>
      Reflect.getMetadata(
        AUTH_POLICY_SCOPE_KEY,
        PageTemplateController.prototype[method],
      ) as AuthPolicyScopeMetadata | undefined;

    expect(metadata('getWorkspacePolicy')).toEqual({ scope: 'workspace' });
    expect(metadata('updateWorkspacePolicy')).toEqual({ scope: 'workspace' });
    for (const method of [
      'getSpacePolicy',
      'updateSpacePolicy',
      'listPolicyGroups',
      'getGroupPolicy',
      'updateGroupPolicy',
    ] as const) {
      expect(metadata(method)).toEqual({
        scope: 'space',
        source: 'params',
        key: 'spaceId',
      });
    }
    expect(metadata('listUsages')).toEqual({
      scope: 'page',
      source: 'params',
      key: 'pageId',
    });
  });

  it('allows workspace assurance but rejects stricter space assurance', async () => {
    const workspace = {
      id: user.workspaceId,
      enforceSso: false,
      enforceMfa: false,
      settings: {},
    } as any;
    const session = {
      id: 'session-1',
      ssoVerifiedAt: null,
      mfaVerifiedAt: null,
    } as any;
    const spacePolicy = new SpacePolicyService({} as any);
    jest.spyOn(spacePolicy, 'resolveSpaceId').mockResolvedValue(spaceId);
    jest.spyOn(spacePolicy, 'resolve').mockResolvedValue({
      overrides: {
        enforceSso: false,
        enforceMfa: true,
        disablePublicSharing: null,
      },
      effective: {
        enforceSso: false,
        enforceMfa: true,
        disablePublicSharing: false,
      },
    });
    const assurance = new AuthenticationAssuranceService(
      {} as any,
      spacePolicy,
      {} as any,
    );
    const request = {
      user: { workspace, session },
      params: { spaceId },
      query: {},
      body: {},
    };
    const workspaceMetadata = Reflect.getMetadata(
      AUTH_POLICY_SCOPE_KEY,
      PageTemplateController.prototype.getWorkspacePolicy,
    );
    const spaceMetadata = Reflect.getMetadata(
      AUTH_POLICY_SCOPE_KEY,
      PageTemplateController.prototype.getSpacePolicy,
    );

    await expect(
      assurance.assertRequestScope(workspaceMetadata, request),
    ).resolves.toBeUndefined();
    try {
      await assurance.assertRequestScope(spaceMetadata, request);
      throw new Error('Expected space assurance failure');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(428);
      expect((error as HttpException).getResponse()).toMatchObject({
        code: 'AUTHENTICATION_ASSURANCE_REQUIRED',
        scope: 'space',
        spaceId,
        requirements: ['mfa'],
      });
    }
  });
});
