import { BadRequestException } from '@nestjs/common';
import { SsoEndpointPolicyService } from '../../integrations/environment/sso-endpoint-policy.service';

describe('SsoEndpointPolicyService', () => {
  const createService = (allowed = '', development = false) =>
    new SsoEndpointPolicyService({
      getSsoAllowedEndpoints: () => allowed,
      isDevelopment: () => development,
    } as any);

  it('rejects endpoints that are not explicitly allowed in production', async () => {
    await expect(
      createService().assertAllowed(
        'https://127.0.0.1/issuer',
        ['http:', 'https:'],
        'OIDC issuer',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a development loopback endpoint', async () => {
    await expect(
      createService('', true).assertAllowed(
        'http://127.0.0.1:5556/issuer',
        ['http:', 'https:'],
        'OIDC issuer',
      ),
    ).resolves.toMatchObject({ protocol: 'http:' });
  });

  it('supports explicitly allowlisted LDAP endpoints', async () => {
    await expect(
      createService('ldaps://10.0.0.5:636').assertAllowed(
        'ldaps://10.0.0.5/directory',
        ['ldap:', 'ldaps:'],
        'LDAP',
      ),
    ).resolves.toMatchObject({ protocol: 'ldaps:' });
  });

  it('rejects URL credentials even on an allowlisted origin', async () => {
    await expect(
      createService('https://idp.example.com').assertAllowed(
        'https://user:password@idp.example.com/issuer',
        ['http:', 'https:'],
        'OIDC issuer',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a non-allowlisted endpoint before resolving its hostname', async () => {
    const service = createService('https://idp.example.com');
    const resolveAddresses = jest.spyOn(service as any, 'resolveAddresses');

    await expect(
      service.assertAllowed(
        'https://not-allowed.audit.invalid/issuer',
        ['http:', 'https:'],
        'OIDC issuer',
      ),
    ).rejects.toThrow('not in SSO_ALLOWED_ENDPOINTS');
    // An endpoint the deployment never allowed must not become an outbound DNS
    // lookup for an attacker-chosen name.
    expect(resolveAddresses).not.toHaveBeenCalled();
  });
});
