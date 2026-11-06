const { test, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const current = require('../.homeybuild/lib/auxcloud/client');
const legacy = require('../.homeybuild/lib/auxcloud/legacyClient');
const { AuthManager, AuthPausedError } = require('../.homeybuild/lib/auxcloud/auth');
const en = require('../locales/en.json');

afterEach(() => mock.restoreAll());

const credentials = { email: 'guest@example.com', password: 'test-password', protocol: 'new', country: 'NLD' };
const session = { token: 'test-token', uid: 'test-user', nickName: 'test' };
const remoteDevice = { deviceId: 'test-device', alias: 'Airco', mac: 'test-mac', status: { control: '00'.repeat(20), running: '00'.repeat(20) } };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const loginError = (code) => new current.AuxApiError('Login rejected', code, '/app/auth/login/pwd', 200);
const expired = () => new current.AuxApiError('Expired session', 401, '/app/user_device', 200, 'Session expired');

function host(settings = new Map()) {
  return {
    settings: { get: (key) => settings.get(key), set: (key, value) => settings.set(key, value), unset: (key) => settings.delete(key) },
    __: (key) => key.split('.').reduce((value, part) => value[part], en),
    notifications: { createNotification: mock.fn(async () => {}) },
    clock: { getTimezone: async () => 'Europe/Amsterdam' },
    setInterval: () => 1,
    clearInterval: () => {},
    flow: { getDeviceTriggerCard: () => ({ trigger: async () => {} }) },
  };
}

class FakeDevice {
  constructor(homey, store, id = 'test-device') {
    this.homey = homey;
    this.store = { ...store };
    this.data = { id };
    this.listeners = {};
    this.capabilities = {};
    this.errors = [];
    this.available = false;
  }
  getStore() { return { ...this.store }; }
  getStoreValue(key) { return this.store[key] ?? null; }
  async setStoreValue(key, value) { this.store[key] = value; }
  getData() { return this.data; }
  registerCapabilityListener(key, fn) { this.listeners[key] = fn; }
  getCapabilityValue(key) { return this.capabilities[key]; }
  async setCapabilityValue(key, value) { this.capabilities[key] = value; }
  async setUnavailable(message) { this.available = false; this.message = message; }
  async setAvailable() { this.available = true; this.message = null; }
  error(...args) { this.errors.push(args); }
}

class FakeDriver {
  constructor(homey, devices = []) { this.homey = homey; this.devices = devices; }
  getDevices() { return this.devices; }
}

function loadHomeyClass(relativePath, overrides = {}) {
  const filename = path.resolve(__dirname, '../.homeybuild', relativePath);
  const localRequire = createRequire(filename);
  const mod = { exports: {} };
  const load = (name) => name === 'homey' ? { Device: FakeDevice, Driver: FakeDriver } : (overrides[name] ?? localRequire(name));
  vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(load, mod, mod.exports);
  return mod.exports;
}

const Device = loadHomeyClass('drivers/airco/device.js');
const Driver = loadHomeyClass('drivers/airco/driver.js', { './device': Device });
const pairSession = () => ({ handlers: {}, setHandler(event, callback) { this.handlers[event] = callback; } });

for (const code of [60009, 9021, 9022]) {
  test(`error ${code} stops background login, controls and restart retries`, async () => {
    const settings = new Map();
    const homey = host(settings);
    let now = 1000;
    const auth = new AuthManager(homey, () => now);
    const login = mock.method(current, 'login', async () => { throw loginError(code); });
    await assert.rejects(auth.authenticate(credentials), AuthPausedError);
    for (let attempt = 0; attempt < 4; attempt++) await assert.rejects(auth.run(credentials, async () => assert.fail('must not contact devices')), AuthPausedError);
    now += 20 * 60 * 1000;
    await assert.rejects(auth.authenticate(credentials), AuthPausedError);
    const restarted = new AuthManager(host(settings), () => now);
    restarted.seed(credentials, session);
    await assert.rejects(restarted.authenticate(credentials), AuthPausedError);
    assert.equal(login.mock.callCount(), 1);
  });
}

for (const code of [9021, 9022]) {
  test(`error ${code} enforces ten minutes before explicit repair`, async () => {
    let now = 0;
    const homey = host();
    const auth = new AuthManager(homey, () => now);
    const login = mock.method(current, 'login', async () => { throw loginError(code); });
    await assert.rejects(auth.authenticate(credentials), AuthPausedError);
    login.mock.mockImplementation(async () => session);
    now = 599999;
    await assert.rejects(auth.authenticate({ ...credentials, password: 'corrected' }, true), AuthPausedError);
    assert.equal(login.mock.callCount(), 1);
    now = 600000;
    assert.equal(await auth.authenticate({ ...credentials, password: 'corrected' }, true), session);
    assert.equal(login.mock.callCount(), 2);
  });
}

test('wrong credentials can be explicitly repaired, and old passwords cannot replace the session', async () => {
  const auth = new AuthManager(host());
  const login = mock.method(current, 'login', async () => { throw loginError(60009); });
  await assert.rejects(auth.authenticate(credentials), AuthPausedError);
  login.mock.mockImplementation(async () => session);
  const corrected = { ...credentials, password: 'corrected' };
  await auth.authenticate(corrected, true);
  await assert.rejects(auth.authenticate(credentials), AuthPausedError);
  assert.equal(await auth.authenticate(corrected), session);
  assert.equal(login.mock.callCount(), 2);
});

test('one pending login is shared by several devices and controls', async () => {
  const auth = new AuthManager(host());
  const response = deferred();
  const login = mock.method(current, 'login', () => response.promise);
  const attempts = Array.from({ length: 6 }, () => auth.authenticate(credentials));
  response.resolve(session);
  assert.deepEqual(await Promise.all(attempts), Array(6).fill(session));
  assert.equal(login.mock.callCount(), 1);
});

test('simultaneous failed logins cause only one password attempt', async () => {
  const auth = new AuthManager(host());
  const response = deferred();
  const login = mock.method(current, 'login', () => response.promise);
  const attempts = Array.from({ length: 6 }, () => auth.authenticate(credentials));
  response.reject(loginError(60009));
  const results = await Promise.allSettled(attempts);
  assert.ok(results.every((result) => result.status === 'rejected' && result.reason instanceof AuthPausedError));
  assert.equal(login.mock.callCount(), 1);
});

test('several expired sessions cause one shared reauthentication', async () => {
  const auth = new AuthManager(host());
  auth.seed(credentials, { ...session, token: 'old' });
  const response = deferred();
  const login = mock.method(current, 'login', () => response.promise);
  const action = async (cloudSession) => { if (cloudSession.token === 'old') throw expired(); return 'ok'; };
  const attempts = [auth.run(credentials, action), auth.run(credentials, action)];
  response.resolve(session);
  assert.deepEqual(await Promise.all(attempts), ['ok', 'ok']);
  assert.equal(login.mock.callCount(), 1);
});

test('network, server and device failures do not trigger password logins', async () => {
  const auth = new AuthManager(host());
  auth.seed(credentials, session);
  const login = mock.method(current, 'login', async () => assert.fail('unexpected login'));
  for (const error of [new TypeError('fetch failed'), new current.AuxApiError('Server down', 500, '/app/user_device', 503), new current.AuxApiError('Device offline', 60001, '/app/device/v2/control', 200)]) {
    await assert.rejects(auth.run(credentials, async () => { throw error; }), (result) => result === error);
  }
  assert.equal(login.mock.callCount(), 0);
});

test('temporary login transport failures remain retryable', async () => {
  const auth = new AuthManager(host());
  const login = mock.method(current, 'login', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(auth.authenticate(credentials), TypeError);
  login.mock.mockImplementation(async () => session);
  assert.equal(await auth.authenticate(credentials), session);
});

test('legacy login rejection also pauses, including after a restart', async () => {
  const homey = host();
  const auth = new AuthManager(homey);
  const legacyCredentials = { ...credentials, protocol: 'legacy', region: 'eu' };
  const login = mock.method(legacy, 'login', async () => { throw new legacy.LegacyAuxApiError('Rejected', -100, 'account/login', 200); });
  await assert.rejects(auth.authenticate(legacyCredentials), AuthPausedError);
  await assert.rejects(new AuthManager(homey).authenticate(legacyCredentials), AuthPausedError);
  assert.equal(login.mock.callCount(), 1);
});

test('only one notification is created per account incident, including restarts', async () => {
  const homey = host();
  const auth = new AuthManager(homey);
  mock.method(current, 'login', async () => { throw loginError(60009); });
  await assert.rejects(auth.authenticate(credentials));
  await Promise.all([auth.notifyOnce(credentials, 'paused'), auth.notifyOnce(credentials, 'paused')]);
  await new AuthManager(homey).notifyOnce(credentials, 'paused');
  assert.equal(homey.notifications.createNotification.mock.callCount(), 1);
});

test('real device initialization survives a bad login and rejects subsequent controls without retrying', async () => {
  const homey = host();
  const login = mock.method(current, 'login', async () => { throw loginError(60009); });
  const device = new Device(homey, credentials);
  await device.onInit();
  assert.equal(device.available, false);
  assert.match(device.message, /Automatic login has stopped/);
  assert.match(device.message, /guest account/);
  assert.equal(Object.keys(device.listeners).length, 4);
  await device.pollState();
  await assert.rejects(device.listeners.onoff(true), AuthPausedError);
  assert.equal(login.mock.callCount(), 1);
  assert.equal(homey.notifications.createNotification.mock.callCount(), 1);
});

test('repair preserves the device identity and updates credentials for other devices on the same account', async () => {
  const homey = host();
  const first = new Device(homey, credentials);
  const second = new Device(homey, credentials, 'second-device');
  const login = mock.method(current, 'login', async () => { throw loginError(60009); });
  await Promise.all([first.onInit(), second.onInit()]);
  login.mock.mockImplementation(async () => session);
  mock.method(current, 'listDevices', async () => [remoteDevice]);
  const pairing = pairSession();
  await new Driver(homey, [first, second]).onRepair(pairing, first);
  assert.equal(await pairing.handlers.login({ username: credentials.email, password: 'corrected' }), true);
  assert.equal(first.getData().id, 'test-device');
  assert.equal(second.getData().id, 'second-device');
  assert.equal(first.getStore().password, 'corrected');
  assert.equal(second.getStore().password, 'corrected');
  assert.equal(first.available, true);
  assert.equal(login.mock.callCount(), 2);
});

test('repair refuses an account without access to the existing air conditioner', async () => {
  const homey = host();
  const device = new Device(homey, credentials);
  mock.method(current, 'login', async () => session);
  mock.method(current, 'listDevices', async () => [{ ...remoteDevice, deviceId: 'different-device' }]);
  await assert.rejects(device.repairCredentials('new-guest@example.com', 'new-password'), /not visible/);
  assert.equal(device.getStore().email, credentials.email);
  assert.equal(device.getStore().password, credentials.password);
  assert.equal(device.getData().id, 'test-device');
});

test('switching to a guest account only changes the repaired device', async () => {
  const homey = host();
  const first = new Device(homey, credentials);
  const second = new Device(homey, credentials, 'second-device');
  mock.method(current, 'login', async () => session);
  mock.method(current, 'listDevices', async () => [remoteDevice]);
  const pairing = pairSession();
  await new Driver(homey, [first, second]).onRepair(pairing, first);
  await pairing.handlers.login({ username: 'new-guest@example.com', password: 'new-password' });
  assert.equal(first.getStore().email, 'new-guest@example.com');
  assert.equal(second.getStore().email, credentials.email);
});

for (const code of [9021, 9022]) {
  test(`pairing does not hide error ${code} behind legacy fallback or allow early retries`, async () => {
    const homey = host();
    const login = mock.method(current, 'login', async () => { throw loginError(code); });
    const legacyLogin = mock.method(legacy, 'login', async () => assert.fail('must not probe another backend'));
    const pairing = pairSession();
    await new Driver(homey).onPair(pairing);
    const data = { username: credentials.email, password: credentials.password };
    await assert.rejects(pairing.handlers.login(data), AuthPausedError);
    await assert.rejects(pairing.handlers.login(data), AuthPausedError);
    assert.equal(login.mock.callCount(), 1);
    assert.equal(legacyLogin.mock.callCount(), 0);
  });
}

test('pairing still supports legacy accounts and stores the authenticated session', async () => {
  const homey = host();
  mock.method(current, 'login', async () => { throw loginError(60009); });
  mock.method(legacy, 'login', async () => ({ loginsession: 'legacy-token', userid: 'legacy-user' }));
  mock.method(legacy, 'listDevices', async () => [{ endpointId: 'legacy-device', friendlyName: 'Legacy Airco' }]);
  const pairing = pairSession();
  await new Driver(homey).onPair(pairing);
  assert.equal(await pairing.handlers.login({ username: credentials.email, password: credentials.password }), true);
  const devices = await pairing.handlers.list_devices();
  assert.equal(devices[0].store.protocol, 'legacy');
  assert.equal(devices[0].store.legacySession.loginsession, 'legacy-token');
});

test('pairing explains an empty device list instead of silently proceeding', async () => {
  mock.method(current, 'login', async () => session);
  mock.method(current, 'listDevices', async () => []);
  const pairing = pairSession();
  await new Driver(host()).onPair(pairing);
  await pairing.handlers.login({ username: credentials.email, password: credentials.password });
  await assert.rejects(pairing.handlers.list_devices(), /share it with your AUX guest account/);
});

test('current client preserves error metadata without embedding response data in logs', async () => {
  mock.method(global, 'fetch', async () => new Response(JSON.stringify({ code: 9021, message: 'Account locked', privateData: 'must-not-be-logged' })));
  await assert.rejects(current.listDevices('test-token'), (error) => {
    assert.equal(error.code, 9021);
    assert.equal(error.apiMessage, 'Account locked');
    assert.equal(error.path, '/app/user_device');
    assert.ok(!error.message.includes('must-not-be-logged'));
    return true;
  });
});

test('legacy client preserves login rejection metadata for the pause guard', async () => {
  mock.method(global, 'fetch', async () => new Response(JSON.stringify({ status: -100, msg: 'Incorrect account or password' })));
  await assert.rejects(legacy.login('guest@example.com', 'password', 'eu'), (error) => {
    assert.equal(error.code, -100);
    assert.equal(error.path, 'account/login');
    return true;
  });
});

test('HTTP 429 pauses login even for a non-JSON response', async () => {
  const auth = new AuthManager(host());
  const fetch = mock.method(global, 'fetch', async () => new Response('Too many requests', { status: 429 }));
  await assert.rejects(auth.authenticate(credentials), AuthPausedError);
  await assert.rejects(auth.authenticate(credentials), AuthPausedError);
  assert.equal(fetch.mock.callCount(), 1);
});

test('the reported expired-token failure stops all later polls and Flow controls', async () => {
  const homey = host();
  const login = mock.method(current, 'login', async () => { throw loginError(60009); });
  const list = mock.method(current, 'listDevices', async () => { throw expired(); });
  const device = new Device(homey, { ...credentials, bearer: 'expired-token' });
  await device.onInit();
  for (let minute = 0; minute < 20; minute++) await device.pollState();
  await assert.rejects(device.listeners.target_temperature(21), AuthPausedError);
  assert.equal(login.mock.callCount(), 1);
  assert.equal(list.mock.callCount(), 1);
  assert.equal(device.available, false);
});

test('an already-running successful request cannot clear another request’s account pause', async () => {
  const auth = new AuthManager(host());
  auth.seed(credentials, session);
  const response = deferred();
  const started = deferred();
  const lateSuccess = auth.run(credentials, async () => { started.resolve(); return response.promise; });
  await started.promise;
  await assert.rejects(auth.run(credentials, async () => { throw loginError(9021); }), AuthPausedError);
  response.resolve('ok');
  await assert.rejects(lateSuccess, AuthPausedError);
});

test('repair waits for an existing poll and blocks controls until credentials are saved', async () => {
  const homey = host();
  const response = deferred();
  const started = deferred();
  const login = mock.method(current, 'login', async () => session);
  const list = mock.method(current, 'listDevices', async () => { started.resolve(); return response.promise; });
  const device = new Device(homey, { ...credentials, bearer: 'existing-token' });
  const initializing = device.onInit();
  await started.promise;
  list.mock.mockImplementation(async () => [remoteDevice]);
  const repair = device.repairCredentials(credentials.email, 'corrected');
  await assert.rejects(device.listeners.onoff(true), /repair is complete/);
  assert.equal(login.mock.callCount(), 0);
  response.resolve([remoteDevice]);
  await Promise.all([initializing, repair]);
  assert.equal(device.getStore().password, 'corrected');
  assert.equal(login.mock.callCount(), 1);
});

test('a lockout during repair device verification is also persisted', async () => {
  const homey = host();
  const login = mock.method(current, 'login', async () => session);
  const list = mock.method(current, 'listDevices', async () => { throw loginError(9021); });
  const device = new Device(homey, credentials);
  await assert.rejects(device.repairCredentials(credentials.email, 'corrected'), AuthPausedError);
  await assert.rejects(device.repairCredentials(credentials.email, 'corrected'), AuthPausedError);
  assert.equal(login.mock.callCount(), 1);
  assert.equal(list.mock.callCount(), 1);
  assert.equal(device.getStore().password, credentials.password);
});

test('notification delivery failure cannot shorten a newer lockout', async () => {
  const homey = host();
  let now = 0;
  const auth = new AuthManager(homey, () => now);
  const login = mock.method(current, 'login', async () => { throw loginError(60009); });
  await assert.rejects(auth.authenticate(credentials), AuthPausedError);
  const notification = deferred();
  homey.notifications.createNotification.mock.mockImplementation(() => notification.promise);
  const notify = auth.notifyOnce(credentials, 'paused');
  login.mock.mockImplementation(async () => { throw loginError(9021); });
  await assert.rejects(auth.authenticate(credentials, true), AuthPausedError);
  notification.reject(new Error('Notification service unavailable'));
  await assert.rejects(notify);
  now = 599999;
  await assert.rejects(auth.authenticate(credentials, true), AuthPausedError);
  assert.equal(login.mock.callCount(), 2);
});

test('Dutch and English cover every account screen and error message', () => {
  const nl = require('../locales/nl.json');
  for (const group of ['auth', 'account']) {
    assert.deepEqual(Object.keys(nl[group]).sort(), Object.keys(en[group]).sort());
    for (const value of Object.values(nl[group])) assert.ok(value.length > 0);
  }
});

test('a login HTTP 401 without an AUX code stops automatic attempts', async () => {
  const auth = new AuthManager(host());
  const login = mock.method(current, 'login', async () => { throw new current.AuxApiError('Unauthorized', undefined, '/app/auth/login/pwd', 401); });
  await assert.rejects(auth.authenticate(credentials), AuthPausedError);
  await assert.rejects(auth.authenticate(credentials), AuthPausedError);
  assert.equal(login.mock.callCount(), 1);
});
