import Homey from 'homey';
import { login, sendControl, listDevices, parseControlState, parseAmbientTemperature } from '../../lib/auxcloud/client';
import {
  HOMEY_MODE_TO_AUX,
  AUX_MODE_TO_HOMEY,
  HOMEY_FAN_TO_AUX,
  WIRE_FAN_TO_HOMEY,
} from '../../lib/auxcloud/constants';

const POLL_INTERVAL_MS = 60 * 1000;

module.exports = class AircoDevice extends Homey.Device {

  private bearer: string | null = null;
  private pollInterval: NodeJS.Timeout | null = null;

  async onInit() {
    await this.ensureLoggedIn();

    this.registerCapabilityListener('onoff', async (value: boolean) => {
      await this.sendIntent({ on_off: value ? 1 : 0 });
    });

    this.registerCapabilityListener('thermostat_mode', async (value: string) => {
      await this.sendIntent({ air_con_func: HOMEY_MODE_TO_AUX[value] ?? 0 });
    });

    this.registerCapabilityListener('target_temperature', async (value: number) => {
      // Halve graden bevestigd leesbaar (control byte12 bit7 = half-graad-vlag).
      // Schrijven van een halve graad is nog niet los getest -- checken bij
      // Fase 4 live-testen dat dit ook echt aankomt en niet afgerond wordt.
      const rounded = Math.round(value * 2) / 2;
      await this.sendIntent({ temperature: rounded });
    });

    this.registerCapabilityListener('aux_fan_speed', async (value: string) => {
      await this.sendIntent({ wind_speed: HOMEY_FAN_TO_AUX[value] ?? 4 });
    });

    this.pollInterval = this.homey.setInterval(() => this.pollState(), POLL_INTERVAL_MS);
    await this.pollState();
  }

  async onUninit() {
    if (this.pollInterval) this.homey.clearInterval(this.pollInterval);
  }

  private async ensureLoggedIn(): Promise<void> {
    const { email, password } = this.getStore();
    const result = await login(email, password);
    this.bearer = result.token;
  }

  private async sendIntent(intent: Record<string, number>): Promise<void> {
    const { id } = this.getData();
    if (!this.bearer) await this.ensureLoggedIn();
    try {
      await sendControl(this.bearer as string, id, intent);
    } catch (err) {
      // Sessie kan verlopen zijn -- eenmalig opnieuw inloggen en herproberen.
      await this.ensureLoggedIn();
      await sendControl(this.bearer as string, id, intent);
    }
  }

  private async pollState(): Promise<void> {
    const { id } = this.getData();
    if (!this.bearer) await this.ensureLoggedIn();

    let devices;
    try {
      devices = await listDevices(this.bearer as string);
    } catch (err) {
      await this.ensureLoggedIn();
      devices = await listDevices(this.bearer as string);
    }

    const device = devices.find((d) => d.deviceId === id);
    if (!device) return;

    const state = parseControlState(device.status.control);

    await this.safeSetCapabilityValue('onoff', state.onoff);
    await this.safeSetCapabilityValue('thermostat_mode', AUX_MODE_TO_HOMEY[state.mode] ?? 'auto');
    await this.safeSetCapabilityValue('target_temperature', state.targetTemperature);
    await this.safeSetCapabilityValue('aux_fan_speed', WIRE_FAN_TO_HOMEY[state.fanSpeedWire] ?? 'auto');
    await this.safeSetCapabilityValue('measure_temperature', parseAmbientTemperature(device.status.running));
    // TODO (Fase 3): swing (state.swingActive) is wel uitleesbaar maar nog niet
    // los per as (verticaal vs. horizontaal), dus nog geen Homey-capability
    // voor. Zie CLOUD-PROTOCOL-NOTES.md voor de volledige geschiedenis.
  }

  private async safeSetCapabilityValue(capability: string, value: unknown): Promise<void> {
    try {
      await this.setCapabilityValue(capability, value as never);
    } catch (err) {
      this.error(`Kon ${capability} niet bijwerken:`, err);
    }
  }

};
