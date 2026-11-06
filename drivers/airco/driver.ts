import Homey from 'homey';
import { listDevices, AuxLoginResult } from '../../lib/auxcloud/client';
import { getCountryFromTimezone } from '../../lib/auxcloud/constants';
import { listDevices as legacyListDevices, LegacyAuxLoginResult } from '../../lib/auxcloud/legacyClient';
import { LEGACY_REGIONS } from '../../lib/auxcloud/legacyConstants';
import {
  getAuthManager, AuthPausedError, Credentials, accountKey,
} from '../../lib/auxcloud/auth';
import AircoDevice = require('./device');

module.exports = class AircoDriver extends Homey.Driver {

  async onPair(session: Homey.Driver.PairSession) {
    let credentials: Credentials | null = null;
    let loginTask: Promise<boolean> | null = null;
    const auth = getAuthManager(this.homey);

    session.setHandler('login', async (data: { username: string; password: string }) => {
      if (loginTask) return loginTask;
      credentials = null;
      loginTask = (async () => {
        const country = getCountryFromTimezone(await this.homey.clock.getTimezone());
        const candidate: Credentials = {
          email: data.username.trim(), password: data.password, country, protocol: 'new',
        };
        if (!candidate.email || !candidate.password) throw new Error(this.homey.__('auth.enter_credentials'));
        try {
          await auth.authenticate(candidate, true);
          credentials = candidate;
          return true;
        } catch (error) {
          // Older accounts may be reported as unknown on the current backend.
          // Never try other backends after a lockout, warning, or network error.
          if (!(error instanceof AuthPausedError) || error.reason !== 'invalid_credentials') throw error;
        }

        for (const region of LEGACY_REGIONS) {
          const legacy: Credentials = { ...candidate, protocol: 'legacy', region };
          try {
            await auth.authenticate(legacy, true);
            credentials = legacy;
            return true;
          } catch (error) {
            if (!(error instanceof AuthPausedError) || error.reason === 'locked' || error.reason === 'lock_warning') throw error;
          }
        }
        throw new Error(this.homey.__('auth.invalid_credentials'));
      })();
      try {
        return await loginTask;
      } finally {
        loginTask = null;
      }
    });

    session.setHandler('list_devices', async () => {
      if (!credentials) throw new Error(this.homey.__('auth.enter_credentials'));
      const verified = credentials;
      const devices = await auth.run(verified, async (cloudSession) => {
        if (verified.protocol === 'new') {
          const bearer = (cloudSession as AuxLoginResult).token;
          return (await listDevices(bearer, verified.country)).map((device) => ({
            name: device.alias || 'AUX Airco',
            data: { id: device.deviceId },
            store: { ...verified, mac: device.mac, bearer },
          }));
        }
        const legacySession = cloudSession as LegacyAuxLoginResult;
        return (await legacyListDevices(legacySession, verified.region!)).map((device) => ({
          name: device.friendlyName || 'AUX Airco',
          data: { id: device.endpointId },
          store: { ...verified, mac: device.mac ?? '', legacySession },
        }));
      });
      if (!devices.length) throw new Error(this.homey.__('auth.no_devices'));
      return devices;
    });
  }

  async onRepair(session: Homey.Driver.PairSession, device: AircoDevice) {
    let repairTask: Promise<boolean> | null = null;
    session.setHandler('login', async (data: { username: string; password: string }) => {
      if (repairTask) return repairTask;
      repairTask = (async () => {
        if (!data.username.trim() || !data.password) throw new Error(this.homey.__('auth.enter_credentials'));
        const previous = device.getCredentials();
        await device.repairCredentials(data.username, data.password);
        const credentials = device.getCredentials();
        // A password update applies to all devices using this account. Switching
        // to a different guest account only changes the selected device.
        if (accountKey(previous) === accountKey(credentials)) {
          for (const other of this.getDevices() as AircoDevice[]) {
            if (other !== device && accountKey(other.getCredentials()) === accountKey(previous)) {
              await other.applyCredentials(credentials);
            }
          }
        }
        return true;
      })();
      try {
        return await repairTask;
      } finally {
        repairTask = null;
      }
    });
  }

};
