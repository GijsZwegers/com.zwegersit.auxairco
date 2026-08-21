import { createCipheriv, publicEncrypt, constants as cryptoConstants } from 'node:crypto';
import {
  AUX_HOST,
  AUX_COUNTRY,
  AUX_USER_AGENT,
  STATIC_APP_TOKEN,
  ACCOUNT_AES_KEY,
} from './constants';

export interface AuxDevice {
  deviceId: string;
  mac: string;
  alias: string;
  modelId: string;
  online: boolean;
  status: {
    running: string;
    control: string;
    type: string;
  };
}

// Last-commanded state, decoded from status.control, which shares its bit
// layout with the older local Broadlink AC protocol. Does not include
// ambient temperature (see parseAmbientTemperature below).
export interface AuxControlState {
  onoff: boolean;
  mode: number;
  targetTemperature: number;
  /** Wire-level fan speed (1=high, 2=medium, 3=low, 4=turbo, 5=auto) -- see WIRE_FAN_TO_HOMEY. */
  fanSpeedWire: number;
  /** True if vertical OR horizontal swing is active; the two axes can't be told apart yet. */
  swingActive: boolean;
}

export function parseControlState(controlHex: string): AuxControlState {
  const bytes = controlHex.match(/../g)!.map((b) => parseInt(b, 16));
  const hasHalfDegree = (bytes[12] & 0x80) !== 0;
  return {
    onoff: ((bytes[18] >> 5) & 1) === 1,
    mode: bytes[15] >> 5,
    targetTemperature: (bytes[10] >> 3) + 8 + (hasHalfDegree ? 0.5 : 0),
    fanSpeedWire: bytes[13] >> 5,
    swingActive: bytes[11] !== 0x20,
  };
}

// Ambient (room) temperature from status.running, byte 15: `byte - 32`,
// whole degrees only. Confirmed against a controlled measurement session,
// including an isolated case where only the room temperature changed (24°C
// -> 20°C, mode/fan/swing/target held constant) and the byte dropped by
// exactly 4.
export function parseAmbientTemperature(runningHex: string): number {
  const bytes = runningHex.match(/../g)!.map((b) => parseInt(b, 16));
  return bytes[15] - 32;
}

export interface AuxLoginResult {
  token: string;
  uid: string;
  nickName: string;
}

export class AuxApiError extends Error {}

interface RequestOptions {
  bearer?: string;
  country?: string;
  query?: Record<string, string>;
  body?: unknown;
}

function baseHeaders(bearer: string, country: string): Record<string, string> {
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US',
    aid: '1',
    os: '2',
    country,
    'User-Agent': AUX_USER_AGENT,
    Authorization: `bearer ${bearer}`,
  };
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(AUX_HOST + path);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
  }
  const headers = baseHeaders(options.bearer ?? STATIC_APP_TOKEN, options.country ?? AUX_COUNTRY);
  let payload: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  const res = await fetch(url, { method, headers, body: payload });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AuxApiError(`Could not parse response from ${path} (HTTP ${res.status}): ${text}`);
  }
  if (json.code !== 200) {
    throw new AuxApiError(`${path} returned an error: ${JSON.stringify(json)}`);
  }
  return json.data as T;
}

function derBase64ToPem(base64Der: string): string {
  const lines = base64Der.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

function encryptAccount(email: string): string {
  const cipher = createCipheriv('aes-128-ecb', ACCOUNT_AES_KEY, null);
  const encrypted = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

// Chunked into 117-byte blocks: the max PKCS1 payload for a 1024-bit key.
function encryptPassword(pem: string, password: string): string {
  const bytes = Buffer.from(password, 'utf8');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 117) {
    const chunk = bytes.subarray(offset, Math.min(offset + 117, bytes.length));
    chunks.push(publicEncrypt({ key: pem, padding: cryptoConstants.RSA_PKCS1_PADDING }, chunk));
  }
  return Buffer.concat(chunks).toString('base64');
}

async function getPubKeyBase64(country: string): Promise<string> {
  return request<string>('GET', '/app/auth/getPubkey', { country });
}

export async function login(email: string, password: string, country: string = AUX_COUNTRY): Promise<AuxLoginResult> {
  const pubkeyBase64 = await getPubKeyBase64(country);
  const pem = derBase64ToPem(pubkeyBase64);
  const account = encryptAccount(email);
  const encryptedPassword = encryptPassword(pem, password);
  const ts = Date.now().toString();

  const data = await request<{
    token: { token: string };
    appUser: { uid: string; nickName: string };
  }>('POST', '/app/auth/login/pwd', {
    country,
    body: { password: encryptedPassword, account, ts, publicKeyBase64: pubkeyBase64 },
  });

  return {
    token: data.token.token,
    uid: data.appUser.uid,
    nickName: data.appUser.nickName,
  };
}

export async function listDevices(bearer: string, country: string = AUX_COUNTRY): Promise<AuxDevice[]> {
  return request<AuxDevice[]>('GET', '/app/user_device', { bearer, country, query: { getStatus: '1' } });
}

export async function sendControl(
  bearer: string,
  deviceId: string,
  intent: Record<string, number>,
  dst = 1,
  country: string = AUX_COUNTRY,
): Promise<void> {
  await request('POST', '/app/device/v2/control', { bearer, country, body: { intent, dst, deviceId } });
}
