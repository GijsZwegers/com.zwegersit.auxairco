import Homey from 'homey';
import {
  sendControl, listDevices, parseControlState, parseAmbientTemperature, AuxLoginResult,
} from '../../lib/auxcloud/client';
import {
  getAuthManager, AuthPausedError, Credentials, CloudSession,
} from '../../lib/auxcloud/auth';
import {
  HOMEY_MODE_TO_AUX,
  AUX_MODE_TO_HOMEY,
  HOMEY_FAN_TO_AUX,
  WIRE_FAN_TO_HOMEY,
  getCountryFromTimezone,
} from '../../lib/auxcloud/constants';
import {
  listDevices as legacyListDevices,
  setParam as legacySetParam,
  LegacyAuxLoginResult,
  LegacyAuxDevice,
} from '../../lib/auxcloud/legacyClient';
import {
  LegacyRegion,
  LEGACY_MODE_TO_HOMEY,
  HOMEY_MODE_TO_LEGACY,
  LEGACY_FAN_TO_HOMEY,
  HOMEY_FAN_TO_LEGACY,
} from '../../lib/auxcloud/legacyConstants';

const POLL_INTERVAL_MS = 60 * 1000;

class AircoDevice extends Homey.Device {

  private country: string = 'NLD';
  private legacyDevice: LegacyAuxDevice | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private pollTask: Promise<void> | null = null;
  private commands = new Set<Promise<void>>();
  private repairing = false;
  private unavailableReason: string | null = null;
  private destroyed = false;

  private get isLegacy(): boolean {
    return this.getStore().protocol === 'legacy';
  }

  async onInit() {
    if (!this.isLegacy) {
      // Devices paired before country-detection existed have no stored
      // value -- resolve it once from the Homey's own timezone and persist
      // it so it doesn't need to be re-derived on every restart.
      let country = this.getStoreValue('country') as string | null;
      if (!country) {
        const timezone = await this.homey.clock.getTimezone();
        country = getCountryFromTimezone(timezone);
        await this.setStoreValue('country', country);
      }
      this.country = country;
    }

    const credentials = this.getCredentials();
    const bearer = this.getStoreValue('bearer') as string | null;
    const legacySession = this.getStoreValue('legacySession') as LegacyAuxLoginResult | null;
    if (this.isLegacy && legacySession) getAuthManager(this.homey).seed(credentials, legacySession);
    if (!this.isLegacy && bearer) getAuthManager(this.homey).seed(credentials, { token: bearer, uid: '', nickName: '' });

    this.registerCapabilityListener('onoff', async (value: boolean) => {
      await this.sendIntent({ new: { on_off: value ? 1 : 0 }, legacy: { pwr: value ? 1 : 0 } });
    });

    this.registerCapabilityListener('thermostat_mode', async (value: string) => {
      await this.sendIntent({
        new: { air_con_func: HOMEY_MODE_TO_AUX[value] ?? 0 },
        legacy: { ac_mode: HOMEY_MODE_TO_LEGACY[value] ?? 4 },
      });
    });

    this.registerCapabilityListener('target_temperature', async (value: number) => {
      const rounded = Math.round(value * 2) / 2;
      await this.sendIntent({
        new: { temperature: rounded },
        legacy: { temp: Math.round(rounded * 10) },
      });
    });

    this.registerCapabilityListener('aux_fan_speed', async (value: string) => {
      await this.sendIntent({
        new: { wind_speed: HOMEY_FAN_TO_AUX[value] ?? 4 },
        legacy: { ac_mark: HOMEY_FAN_TO_LEGACY[value] ?? 0 },
      });
    });

    this.pollInterval = this.homey.setInterval(() => this.pollState(), POLL_INTERVAL_MS);
    await this.pollState();
  }

  async onUninit() {
    this.destroyed = true;
    if (this.pollInterval) this.homey.clearInterval(this.pollInterval);
  }

  getCredentials(): Credentials {
    const { email, password, region } = this.getStore();
    return {
      email, password, region, country: this.country, protocol: this.isLegacy ? 'legacy' : 'new',
    };
  }

  private async withSession<T>(action: (session: CloudSession) => Promise<T>): Promise<T> {
    const credentials = this.getCredentials();
    return getAuthManager(this.homey).run(credentials, async (session) => {
      const result = await action(session);
      await this.saveSession(session);
      return result;
    });
  }

  private async saveSession(session: CloudSession): Promise<void> {
    if ('token' in session) {
      if (this.getStoreValue('bearer') !== session.token) await this.setStoreValue('bearer', session.token);
    } else if ((this.getStoreValue('legacySession') as LegacyAuxLoginResult | null)?.loginsession !== session.loginsession) {
      await this.setStoreValue('legacySession', session);
    }
  }

  async repairCredentials(email: string, password: string): Promise<void> {
    this.repairing = true;
    try {
      await this.pollTask;
      await Promise.allSettled([...this.commands]);
      const credentials = { ...this.getCredentials(), email: email.trim(), password };
      const auth = getAuthManager(this.homey);
      let session = await auth.authenticate(credentials, true);
      const devices = await auth.run(credentials, async (verifiedSession) => {
        session = verifiedSession;
        return this.isLegacy
          ? legacyListDevices(session as LegacyAuxLoginResult, credentials.region as LegacyRegion)
          : listDevices((session as AuxLoginResult).token, credentials.country);
      });
      const found = devices.some((device) => ('deviceId' in device ? device.deviceId : device.endpointId) === this.getData().id);
      if (!found) throw new Error(this.homey.__('auth.device_not_shared'));
      await this.applyCredentials(credentials, session);
    } finally {
      this.repairing = false;
    }
  }

  async applyCredentials(credentials: Credentials, session?: CloudSession): Promise<void> {
    this.repairing = true;
    try {
      await this.pollTask;
      await Promise.allSettled([...this.commands]);
      await this.setStoreValue('email', credentials.email);
      await this.setStoreValue('password', credentials.password);
      this.legacyDevice = null;
      const authenticated = session ?? await getAuthManager(this.homey).authenticate(credentials);
      await this.saveSession(authenticated);
      this.unavailableReason = null;
      await this.setAvailable();
    } finally {
      this.repairing = false;
    }
  }

  private async handleError(error: unknown): Promise<void> {
    if (this.destroyed) return;
    const message = error instanceof AuthPausedError ? error.message : this.homey.__('auth.unreachable');
    if (message !== this.unavailableReason) {
      this.unavailableReason = message;
      await this.setUnavailable(message);
    }
    if (error instanceof AuthPausedError) {
      await getAuthManager(this.homey).notifyOnce(this.getCredentials(), message).catch((err: unknown) => this.error('Could not notify about login problem:', err));
    } else {
      this.error('Cloud request failed; will retry on the next poll:', error);
    }
  }

  private async sendIntent(intent: { new: Record<string, number>; legacy: Record<string, number> }): Promise<void> {
    if (this.repairing) throw new Error(this.homey.__('auth.repairing'));
    const task = (async () => {
      try {
        if (this.isLegacy) {
          await this.sendLegacyIntent(intent.legacy);
        } else {
          await this.sendNewIntent(intent.new);
        }
      } catch (error) {
        await this.handleError(error);
        throw error;
      }
    })();
    this.commands.add(task);
    try {
      await task;
    } finally {
      this.commands.delete(task);
    }
  }

  private async sendNewIntent(intent: Record<string, number>): Promise<void> {
    const { id } = this.getData();
    await this.withSession((session) => sendControl((session as AuxLoginResult).token, id, intent, 1, this.country));
  }

  private async sendLegacyIntent(intent: Record<string, number>): Promise<void> {
    if (!this.legacyDevice) await this.pollLegacyState();
    if (!this.legacyDevice) throw new Error('Device not found on the legacy AUX Cloud backend.');

    const [param, value] = Object.entries(intent)[0];
    const region = this.getStore().region as LegacyRegion;
    await this.withSession((session) => legacySetParam(session as LegacyAuxLoginResult, region, this.legacyDevice as LegacyAuxDevice, param, value));
  }

  // Polls never overlap or reject from the unattended timer.
  private async pollState(): Promise<void> {
    if (this.destroyed || this.repairing) return;
    if (this.pollTask) {
      await this.pollTask;
      return;
    }
    this.pollTask = (async () => {
      try {
        if (this.isLegacy) {
          await this.pollLegacyState();
        } else {
          await this.pollNewState();
        }
        if (!this.destroyed) {
          getAuthManager(this.homey).assertAllowed(this.getCredentials());
          await this.setAvailable();
          this.unavailableReason = null;
        }
      } catch (err) {
        await this.handleError(err);
      }
    })().catch((err: unknown) => this.error('Could not update device availability:', err));
    try {
      await this.pollTask;
    } finally {
      this.pollTask = null;
    }
  }

  private async pollNewState(): Promise<void> {
    const { id } = this.getData();
    const devices = await this.withSession((session) => listDevices((session as AuxLoginResult).token, this.country));

    const device = devices.find((d) => d.deviceId === id);
    if (!device) throw new Error(this.homey.__('auth.device_not_shared'));

    const state = parseControlState(device.status.control);

    await this.safeSetCapabilityValue('onoff', state.onoff);
    await this.safeSetCapabilityValue('thermostat_mode', AUX_MODE_TO_HOMEY[state.mode] ?? 'auto');
    await this.safeSetCapabilityValue('target_temperature', state.targetTemperature);
    await this.updateFanSpeed(WIRE_FAN_TO_HOMEY[state.fanSpeedWire] ?? 'auto');
    await this.safeSetCapabilityValue('measure_temperature', parseAmbientTemperature(device.status.running));
    // state.swingActive is readable but not yet split into vertical vs.
    // horizontal, so there's no Homey capability for it yet.
  }

  private async pollLegacyState(): Promise<void> {
    const { id } = this.getData();
    const region = this.getStore().region as LegacyRegion;
    const devices = await this.withSession((session) => legacyListDevices(session as LegacyAuxLoginResult, region));

    const device = devices.find((d) => d.endpointId === id);
    if (!device) throw new Error(this.homey.__('auth.device_not_shared'));
    this.legacyDevice = device;

    const p = device.params;
    await this.safeSetCapabilityValue('onoff', p.pwr === 1);
    await this.safeSetCapabilityValue('thermostat_mode', LEGACY_MODE_TO_HOMEY[p.ac_mode] ?? 'auto');
    if (typeof p.temp === 'number') await this.safeSetCapabilityValue('target_temperature', p.temp / 10);
    await this.updateFanSpeed(LEGACY_FAN_TO_HOMEY[p.ac_mark] ?? 'auto');
    if (typeof p.envtemp === 'number') await this.safeSetCapabilityValue('measure_temperature', p.envtemp / 10);
    // ac_vdir/ac_hdir (swing) aren't mapped to a capability yet, same as
    // the new backend's unresolved vertical-vs-horizontal swing status.
  }

  // aux_fan_speed is a custom capability, so unlike onoff/thermostat_mode
  // (standard capabilities, whose matching trigger cards Homey fires
  // automatically), its "changed" Flow trigger has to be fired by hand
  // whenever the value actually changes.
  private async updateFanSpeed(value: string): Promise<void> {
    const previous = this.getCapabilityValue('aux_fan_speed');
    await this.safeSetCapabilityValue('aux_fan_speed', value);
    if (previous !== value) {
      await this.homey.flow.getDeviceTriggerCard('fan_speed_changed').trigger(this, { aux_fan_speed: value }, {}).catch((err: unknown) => {
        this.error('Could not fire fan_speed_changed trigger:', err);
      });
    }
  }

  private async safeSetCapabilityValue(capability: string, value: unknown): Promise<void> {
    try {
      await this.setCapabilityValue(capability, value as never);
    } catch (err) {
      this.error(`Could not update ${capability}:`, err);
    }
  }

}

export = AircoDevice;
