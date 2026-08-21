// Client for AUX's OLDER Broadlink-hosted cloud backend
// (app-service-*.smarthomecs.*), used as a login fallback when an account
// doesn't exist on the newer backend `client.ts` talks to. Ported from
// fparrav/homebridge-aux-cloud (MIT), already credited in README.md.
//
// Unlike the new backend, only the login request body is encrypted (AES-CBC
// with a per-request, timestamp-derived key) -- every other request/response
// is plain JSON, authenticated via `loginsession`/`userid` headers instead
// of a bearer token.

import { createCipheriv, createHash } from 'node:crypto';
import {
  LEGACY_REGION_URLS,
  LEGACY_TIMESTAMP_TOKEN_ENCRYPT_KEY,
  LEGACY_PASSWORD_ENCRYPT_KEY,
  LEGACY_BODY_ENCRYPT_KEY,
  LEGACY_AES_IV,
  LEGACY_LICENSE,
  LEGACY_LICENSE_ID,
  LEGACY_COMPANY_ID,
  LEGACY_SPOOF_APP_VERSION,
  LEGACY_SPOOF_USER_AGENT,
  LEGACY_SPOOF_SYSTEM,
  LEGACY_SPOOF_APP_PLATFORM,
  LEGACY_AC_SPECIAL_PARAMS,
  isLegacyAcProduct,
  type LegacyRegion,
} from './legacyConstants';

export class LegacyAuxApiError extends Error {}

export interface LegacyAuxLoginResult {
  loginsession: string;
  userid: string;
}

interface LegacyDeviceSummary {
  endpointId: string;
  friendlyName: string;
  productId: string;
  devSession: string;
  devicetypeFlag: number;
  cookie: string;
  mac?: string;
}

export interface LegacyAuxDevice extends LegacyDeviceSummary {
  params: Record<string, number>;
  online: boolean;
}

function encryptAesCbcZeroPadding(iv: Buffer, key: Buffer, data: Buffer): Buffer {
  const blockSize = 16;
  const paddingNeeded = (blockSize - (data.length % blockSize)) % blockSize;
  const padded = paddingNeeded === 0 ? data : Buffer.concat([data, Buffer.alloc(paddingNeeded)]);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function baseHeaders(loginsession: string, userid: string, additional: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    licenseId: LEGACY_LICENSE_ID,
    lid: LEGACY_LICENSE_ID,
    language: 'en',
    appVersion: LEGACY_SPOOF_APP_VERSION,
    'User-Agent': LEGACY_SPOOF_USER_AGENT,
    system: LEGACY_SPOOF_SYSTEM,
    appPlatform: LEGACY_SPOOF_APP_PLATFORM,
    loginsession,
    userid,
    ...additional,
  };
}

function directiveHeader(namespace: string, name: string, messageIdPrefix: string, extra: Record<string, string> = {}) {
  return {
    namespace,
    name,
    interfaceVersion: '2',
    senderId: 'sdk',
    messageId: `${messageIdPrefix}-${Math.floor(Date.now() / 1000)}`,
    ...extra,
  };
}

async function request<T>(
  region: LegacyRegion,
  path: string,
  options: { headers: Record<string, string>; body?: unknown; rawBody?: Buffer; query?: Record<string, string> },
): Promise<T> {
  const url = new URL(LEGACY_REGION_URLS[region] + '/' + path.replace(/^\//, ''));
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) url.searchParams.set(k, v);
  }
  const body = options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined);
  const res = await fetch(url, { method: 'POST', headers: options.headers, body });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new LegacyAuxApiError(`Could not parse legacy response from ${path} (HTTP ${res.status}): ${text}`);
  }
  return json as T;
}

export async function login(email: string, password: string, region: LegacyRegion): Promise<LegacyAuxLoginResult> {
  const timestampSeconds = (Date.now() / 1000).toString();
  const shaPassword = createHash('sha1').update(`${password}${LEGACY_PASSWORD_ENCRYPT_KEY}`).digest('hex');

  const payload = {
    email,
    password: shaPassword,
    companyid: LEGACY_COMPANY_ID,
    lid: LEGACY_LICENSE_ID,
  };
  const jsonPayload = JSON.stringify(payload);
  const token = createHash('md5').update(`${jsonPayload}${LEGACY_BODY_ENCRYPT_KEY}`).digest('hex');
  const aesKey = createHash('md5').update(`${timestampSeconds}${LEGACY_TIMESTAMP_TOKEN_ENCRYPT_KEY}`).digest();
  const encryptedBody = encryptAesCbcZeroPadding(LEGACY_AES_IV, aesKey, Buffer.from(jsonPayload, 'utf8'));

  const data = await request<{ status: number; loginsession: string; userid: string; msg?: string }>(
    region,
    'account/login',
    {
      headers: {
        'Content-Type': 'application/x-java-serialized-object',
        timestamp: timestampSeconds,
        token,
        licenseId: LEGACY_LICENSE_ID,
        lid: LEGACY_LICENSE_ID,
        language: 'en',
        appVersion: LEGACY_SPOOF_APP_VERSION,
        'User-Agent': LEGACY_SPOOF_USER_AGENT,
        system: LEGACY_SPOOF_SYSTEM,
        appPlatform: LEGACY_SPOOF_APP_PLATFORM,
      },
      rawBody: encryptedBody,
    },
  );

  if (data.status !== 0) {
    throw new LegacyAuxApiError(`Legacy login failed: ${JSON.stringify(data)}`);
  }
  return { loginsession: data.loginsession, userid: data.userid };
}

async function listFamilies(session: LegacyAuxLoginResult, region: LegacyRegion): Promise<string[]> {
  const data = await request<{ status: number; data: { familyList: Array<{ familyid: string }> } }>(
    region,
    'appsync/group/member/getfamilylist',
    { headers: baseHeaders(session.loginsession, session.userid) },
  );
  if (data.status !== 0) {
    throw new LegacyAuxApiError(`Could not list legacy families: ${JSON.stringify(data)}`);
  }
  return data.data.familyList.map((f) => f.familyid);
}

async function fetchDevicesForFamily(
  session: LegacyAuxLoginResult,
  region: LegacyRegion,
  familyId: string,
  shared: boolean,
): Promise<LegacyDeviceSummary[]> {
  const endpoint = shared
    ? 'appsync/group/sharedev/querylist?querytype=shared'
    : 'appsync/group/dev/query?action=select';

  const data = await request<{
    status: number;
    data: {
      endpoints?: LegacyDeviceSummary[];
      shareFromOther?: Array<{ devinfo: LegacyDeviceSummary }>;
    };
  }>(region, endpoint, {
    headers: baseHeaders(session.loginsession, session.userid, { familyid: familyId }),
    body: shared ? { endpointId: '' } : { pids: [] },
  });

  if (data.status !== 0) {
    throw new LegacyAuxApiError(`Could not list legacy devices for family ${familyId}: ${JSON.stringify(data)}`);
  }
  if (data.data.endpoints) return data.data.endpoints;
  if (data.data.shareFromOther) return data.data.shareFromOther.map((item) => item.devinfo);
  return [];
}

async function actOnDeviceParams(
  session: LegacyAuxLoginResult,
  region: LegacyRegion,
  device: LegacyDeviceSummary,
  action: 'get' | 'set',
  params: string[],
  values: number[],
): Promise<Record<string, number>> {
  const cookie = JSON.parse(Buffer.from(device.cookie, 'base64').toString('utf8'));
  const mappedCookie = Buffer.from(
    JSON.stringify({
      device: {
        id: cookie.terminalid,
        key: cookie.aeskey,
        devSession: device.devSession,
        aeskey: cookie.aeskey,
        did: device.endpointId,
        pid: device.productId,
        mac: device.mac,
      },
    }),
  ).toString('base64');

  const payload = {
    directive: {
      header: directiveHeader('DNA.KeyValueControl', 'KeyValueControl', device.endpointId),
      endpoint: {
        devicePairedInfo: {
          did: device.endpointId,
          pid: device.productId,
          mac: device.mac,
          devicetypeflag: device.devicetypeFlag,
          cookie: mappedCookie,
        },
        endpointId: device.endpointId,
        cookie: {},
        devSession: device.devSession,
      },
      payload: {
        act: action,
        params,
        vals: action === 'set' ? values.map((value) => [{ idx: 1, val: value }]) : (params.length === 1 ? [[{ idx: 1, val: 0 }]] : []),
        did: device.endpointId,
      },
    },
  };

  const data = await request<{
    event: { header?: { name?: string }; payload?: { data?: string; status?: number; message?: string } };
  }>(region, 'device/control/v2/sdkcontrol', {
    headers: baseHeaders(session.loginsession, session.userid),
    query: { license: LEGACY_LICENSE },
    body: payload,
  });

  if (data.event?.header?.name === 'ErrorResponse') {
    throw new LegacyAuxApiError(`Legacy device params error: ${data.event.payload?.message ?? JSON.stringify(data)}`);
  }
  const encoded = data.event?.payload?.data;
  if (!encoded) {
    throw new LegacyAuxApiError(`Unexpected legacy params response: ${JSON.stringify(data)}`);
  }
  const parsed = JSON.parse(encoded) as { params: string[]; vals: Array<Array<{ val: number }>> };
  const result: Record<string, number> = {};
  parsed.params.forEach((param, index) => {
    const entry = parsed.vals[index]?.[0];
    if (entry && typeof entry.val === 'number') result[param] = entry.val;
  });
  return result;
}

async function queryOnlineStates(
  session: LegacyAuxLoginResult,
  region: LegacyRegion,
  devices: LegacyDeviceSummary[],
): Promise<Map<string, number>> {
  const data = await request<{
    event: { header?: { name?: string }; payload: { status: number; studata?: Array<{ did: string; state: number }>; data?: Array<{ did: string; state: number }> } };
  }>(region, 'device/control/v2/querystate', {
    headers: baseHeaders(session.loginsession, session.userid),
    body: {
      directive: {
        header: directiveHeader('DNA.QueryState', 'queryState', session.userid, {
          messageType: 'controlgw.batch',
          timstamp: Math.floor(Date.now() / 1000).toString(),
        }),
        payload: {
          studata: devices.map((d) => ({ did: d.endpointId, devSession: d.devSession })),
          msgtype: 'batch',
        },
      },
    },
  });

  const states = new Map<string, number>();
  const list = data.event?.payload?.data ?? data.event?.payload?.studata ?? [];
  for (const item of list) states.set(item.did, item.state);
  return states;
}

export async function listDevices(session: LegacyAuxLoginResult, region: LegacyRegion): Promise<LegacyAuxDevice[]> {
  const familyIds = await listFamilies(session, region);
  const result: LegacyAuxDevice[] = [];

  for (const familyId of familyIds) {
    const owned = await fetchDevicesForFamily(session, region, familyId, false);
    const shared = await fetchDevicesForFamily(session, region, familyId, true);
    const devices = [...owned, ...shared];
    if (devices.length === 0) continue;

    const onlineStates = await queryOnlineStates(session, region, devices);

    for (const device of devices) {
      const params: Record<string, number> = {};
      try {
        // Empty params list -- the backend returns its default param set
        // for the device. Confirmed against fparrav's actual usage
        // (refreshDeviceParams / the base fetch in fetchDevicesForFamily
        // both call this with `[]`, not the full AC_PARAMS list -- that
        // constant exists in the reference repo but is otherwise unused).
        Object.assign(params, await actOnDeviceParams(session, region, device, 'get', [], []));
      } catch {
        // Leave whatever params we already have; a single failed device
        // shouldn't take down the whole list.
      }
      if (isLegacyAcProduct(device.productId)) {
        try {
          Object.assign(params, await actOnDeviceParams(session, region, device, 'get', LEGACY_AC_SPECIAL_PARAMS, []));
        } catch {
          // Same as above.
        }
      }
      result.push({
        ...device,
        params,
        online: (onlineStates.get(device.endpointId) ?? 0) === 1,
      });
    }
  }

  return result;
}

export async function setParam(
  session: LegacyAuxLoginResult,
  region: LegacyRegion,
  device: LegacyAuxDevice,
  param: string,
  value: number,
): Promise<void> {
  await actOnDeviceParams(session, region, device, 'set', [param], [value]);
}
