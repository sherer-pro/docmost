import {
  getWorkspaceHostnameFromCloudHost,
  normalizeHostHeader,
} from './host.util';

describe('host util', () => {
  describe('normalizeHostHeader', () => {
    it('normalizes case, port, and trailing dots', () => {
      expect(normalizeHostHeader('Team.Example.COM:3000.')).toBe(
        'team.example.com',
      );
    });

    it('rejects malformed host values', () => {
      expect(normalizeHostHeader('team.example.com/path')).toBeNull();
      expect(normalizeHostHeader('team example.com')).toBeNull();
      expect(normalizeHostHeader(['team.example.com'])).toBeNull();
    });
  });

  describe('getWorkspaceHostnameFromCloudHost', () => {
    it('extracts a single workspace hostname under the configured root domain', () => {
      expect(
        getWorkspaceHostnameFromCloudHost(
          'Team.Docmost.Test:3000',
          'docmost.test',
        ),
      ).toBe('team');
    });

    it('rejects hosts outside the configured root domain', () => {
      expect(
        getWorkspaceHostnameFromCloudHost(
          'team.attacker.test',
          'docmost.test',
        ),
      ).toBeNull();
    });

    it('rejects nested and invalid workspace labels', () => {
      expect(
        getWorkspaceHostnameFromCloudHost(
          'nested.team.docmost.test',
          'docmost.test',
        ),
      ).toBeNull();
      expect(
        getWorkspaceHostnameFromCloudHost('-team.docmost.test', 'docmost.test'),
      ).toBeNull();
    });
  });
});
