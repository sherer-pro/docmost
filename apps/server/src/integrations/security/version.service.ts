import { Injectable } from '@nestjs/common';
import { getAppVersion } from '../../common/helpers/get-app-version';

@Injectable()
export class VersionService {
  constructor() {}

  async getVersion() {
    const url = `https://api.github.com/repos/docmost/docmost/releases/latest`;

    let latestVersion = 0;
    try {
      const response = await fetch(url);
      if (!response.ok) return;
      const data = await response.json();
      latestVersion = data?.tag_name?.replace('v', '');
    } catch (err) {
      /* empty */
    }

    return {
      currentVersion: getAppVersion(),
      latestVersion: latestVersion,
      releaseUrl: 'https://github.com/docmost/docmost/releases',
    };
  }
}
