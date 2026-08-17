// TypeScript-poort van protocol-test/src/test-cloud.mjs -- zelfde,
// bewezen-werkende logica, alleen getypeerd. Geen nieuw protocolwerk.

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

// Laatst-gecommandeerde staat, uitgelezen uit status.control. Bevestigd
// (2026-08-12) door los power/mode/temperature/fan/swing te wijzigen en de
// resulterende hex te vergelijken -- zelfde bit-indeling als het oude lokale
// Broadlink-protocol. Gemeten-temperatuur zit NIET hierin (zie
// CLOUD-PROTOCOL-NOTES.md, apart nog niet gekraakt).
export interface AuxControlState {
  onoff: boolean;
  mode: number;
  targetTemperature: number;
  /** Wire-fanspeed (1=high,2=medium,3=low,4=turbo,5=auto) -- zie WIRE_FAN_TO_HOMEY. */
  fanSpeedWire: number;
  /**
   * true als verticale óf horizontale swing actief is. Nog niet gelukt om de
   * twee assen apart te herkennen (in alle metingen tot nu toe stonden ze
   * altijd samen aan/uit) -- zie CLOUD-PROTOCOL-NOTES.md.
   */
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

// Gemeten (omgevings)temperatuur uit status.running, byte 15: `byte - 32`.
// Bevestigd (2026-08-17) over 7 van de 8 verse "running"-verversingen uit een
// gecontroleerde meetsessie, inclusief een schone geïsoleerde meting waarbij
// ALLEEN de kamertemperatuur veranderde (24°C -> 20°C, verder identieke
// modus/fan/swing/target) -- de byte daalde daarbij exact van 0x38 naar 0x34
// (56 -> 52), precies de 4 graden verschil. Ook stabiel gebleken over
// wisselende modus (cool/heat/uit), fan-snelheid (low/medium) en swing-status,
// wat de eerdere `byte[16]-23`-gok (zie git-historie) juist deed stuklopen.
// De ene afwijkende meting in de dataset was de allereerste van een sessie en
// wijkt af zoals verwacht bij een net-nog-niet-bijgewerkte afgelezen waarde
// (zelfde AC-app-vertraging die ook elders is waargenomen), niet een gebroken
// formule. Alleen hele graden -- er is geen aanwijzing voor een halve-graad-
// vlag zoals bij targetTemperature.
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
  query?: Record<string, string>;
  body?: unknown;
}

function baseHeaders(bearer: string): Record<string, string> {
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US',
    aid: '1',
    os: '2',
    country: AUX_COUNTRY,
    'User-Agent': AUX_USER_AGENT,
    Authorization: `bearer ${bearer}`,
  };
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(AUX_HOST + path);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
  }
  const headers = baseHeaders(options.bearer ?? STATIC_APP_TOKEN);
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
    throw new AuxApiError(`Kon antwoord van ${path} niet parsen (HTTP ${res.status}): ${text}`);
  }
  if (json.code !== 200) {
    throw new AuxApiError(`${path} gaf een foutcode: ${JSON.stringify(json)}`);
  }
  return json.data as T;
}

function derBase64ToPem(base64Der: string): string {
  const lines = base64Der.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

// "account" (e-mailadres): AES-128-ECB, vaste sleutel, PKCS7-padding.
function encryptAccount(email: string): string {
  const cipher = createCipheriv('aes-128-ecb', ACCOUNT_AES_KEY, null);
  const encrypted = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

// "password": RSA/ECB/PKCS1Padding met de vers-opgehaalde publieke sleutel,
// in blokken van 117 bytes (max. PKCS1-payload voor een 1024-bit sleutel).
function encryptPassword(pem: string, password: string): string {
  const bytes = Buffer.from(password, 'utf8');
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += 117) {
    const chunk = bytes.subarray(offset, Math.min(offset + 117, bytes.length));
    chunks.push(publicEncrypt({ key: pem, padding: cryptoConstants.RSA_PKCS1_PADDING }, chunk));
  }
  return Buffer.concat(chunks).toString('base64');
}

async function getPubKeyBase64(): Promise<string> {
  return request<string>('GET', '/app/auth/getPubkey');
}

export async function login(email: string, password: string): Promise<AuxLoginResult> {
  const pubkeyBase64 = await getPubKeyBase64();
  const pem = derBase64ToPem(pubkeyBase64);
  const account = encryptAccount(email);
  const encryptedPassword = encryptPassword(pem, password);
  const ts = Date.now().toString();

  const data = await request<{
    token: { token: string };
    appUser: { uid: string; nickName: string };
  }>('POST', '/app/auth/login/pwd', {
    body: { password: encryptedPassword, account, ts, publicKeyBase64: pubkeyBase64 },
  });

  return {
    token: data.token.token,
    uid: data.appUser.uid,
    nickName: data.appUser.nickName,
  };
}

export async function listDevices(bearer: string): Promise<AuxDevice[]> {
  return request<AuxDevice[]>('GET', '/app/user_device', { bearer, query: { getStatus: '1' } });
}

export async function sendControl(
  bearer: string,
  deviceId: string,
  intent: Record<string, number>,
  dst = 1,
): Promise<void> {
  await request('POST', '/app/device/v2/control', { bearer, body: { intent, dst, deviceId } });
}
