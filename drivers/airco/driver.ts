import Homey from 'homey';
import { login, listDevices } from '../../lib/auxcloud/client';
import { getCountryFromTimezone } from '../../lib/auxcloud/constants';
import { login as legacyLogin, listDevices as legacyListDevices, LegacyAuxLoginResult } from '../../lib/auxcloud/legacyClient';
import { LEGACY_REGIONS, LegacyRegion } from '../../lib/auxcloud/legacyConstants';

module.exports = class AircoDriver extends Homey.Driver {

  async onPair(session: any) {
    let bearer = '';
    let email = '';
    let password = '';
    let country = '';
    let protocol: 'new' | 'legacy' = 'new';
    let legacySession: LegacyAuxLoginResult | null = null;
    let legacyRegion: LegacyRegion | null = null;

    session.setHandler('login', async (data: { username: string; password: string }) => {
      email = data.username;
      password = data.password;

      const timezone = await this.homey.clock.getTimezone();
      country = getCountryFromTimezone(timezone);

      // Try the current backend first -- this is what works for the
      // overwhelming majority of accounts, so this stays a single request
      // for anyone already on it. Only accounts that don't exist there
      // (older AUX units, e.g. reported for a Q-Smart Plus) fall through to
      // the legacy Broadlink-hosted backend, tried across all 3 of its
      // regions since there's no way to know which one an account is on
      // ahead of time.
      try {
        const result = await login(email, password, country);
        bearer = result.token;
        protocol = 'new';
        return true;
      } catch (err) {
        // Fall through to the legacy backend below.
      }

      for (const region of LEGACY_REGIONS) {
        try {
          legacySession = await legacyLogin(email, password, region);
          legacyRegion = region;
          protocol = 'legacy';
          return true;
        } catch (err) {
          // Try the next region.
        }
      }

      throw new Error('Login failed on both the current and legacy AUX Cloud backends. Double-check your email and password.');
    });

    session.setHandler('list_devices', async () => {
      if (protocol === 'new') {
        const devices = await listDevices(bearer, country);
        return devices.map((device) => ({
          name: device.alias || 'AUX Airco',
          data: { id: device.deviceId },
          store: { mac: device.mac, email, password, protocol: 'new', country },
        }));
      }

      const devices = await legacyListDevices(legacySession as LegacyAuxLoginResult, legacyRegion as LegacyRegion);
      return devices.map((device) => ({
        name: device.friendlyName || 'AUX Airco',
        data: { id: device.endpointId },
        store: { mac: device.mac ?? '', email, password, protocol: 'legacy', region: legacyRegion },
      }));
    });
  }

};
