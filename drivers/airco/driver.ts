import Homey from 'homey';
import { login, listDevices } from '../../lib/auxcloud/client';

module.exports = class AircoDriver extends Homey.Driver {

  async onPair(session: any) {
    let bearer = '';
    let email = '';
    let password = '';

    session.setHandler('login', async (data: { username: string; password: string }) => {
      const result = await login(data.username, data.password);
      bearer = result.token;
      email = data.username;
      password = data.password;
      return true;
    });

    session.setHandler('list_devices', async () => {
      const devices = await listDevices(bearer);
      return devices.map((device) => ({
        name: device.alias || 'AUX Airco',
        data: { id: device.deviceId },
        store: {
          mac: device.mac,
          email,
          password,
        },
      }));
    });
  }

};
