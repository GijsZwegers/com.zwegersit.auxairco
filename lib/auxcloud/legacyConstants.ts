// Constants for AUX's OLDER Broadlink-hosted cloud backend
// (app-service-*.smarthomecs.*), used as a login fallback for accounts that
// don't exist on the newer eu-smthome-api.aux-global.com backend `client.ts`
// talks to. Ported from fparrav/homebridge-aux-cloud (MIT) and
// maeek/ha-aux-cloud (MIT), already credited in README.md -- these are the
// vendor's own fixed app-identity/crypto constants (same category as the
// AES key in constants.ts), not anything secret of ours.

export const LEGACY_REGION_URLS = {
  eu: 'https://app-service-deu-f0e9ebbb.smarthomecs.de',
  usa: 'https://app-service-usa-fd7cc04c.smarthomecs.com',
  cn: 'https://app-service-chn-31a93883.ibroadlink.com',
} as const;

export type LegacyRegion = keyof typeof LEGACY_REGION_URLS;
export const LEGACY_REGIONS: LegacyRegion[] = ['eu', 'usa', 'cn'];

export const LEGACY_TIMESTAMP_TOKEN_ENCRYPT_KEY = 'kdixkdqp54545^#*';
export const LEGACY_PASSWORD_ENCRYPT_KEY = '4969fj#k23#';
export const LEGACY_BODY_ENCRYPT_KEY = 'xgx3d*fe3478$ukx';

// Fixed 16-byte AES IV.
export const LEGACY_AES_IV = Buffer.from(
  [-22, -86, -86, 58, -69, 88, 98, -94, 25, 24, -75, 119, 29, 22, 21, -86].map((v) => (v + 256) % 256),
);

export const LEGACY_LICENSE =
  'PAFbJJ3WbvDxH5vvWezXN5BujETtH/iuTtIIW5CE/SeHN7oNKqnEajgljTcL0fBQQWM0XAAAAAAnBhJyhMi7zIQMsUcwR/PEwGA3uB5HLOnr+xRrci+FwHMkUtK7v4yo0ZHa+jPvb6djelPP893k7SagmffZmOkLSOsbNs8CAqsu8HuIDs2mDQAAAAA=';
export const LEGACY_LICENSE_ID = '3c015b249dd66ef0f11f9bef59ecd737';
export const LEGACY_COMPANY_ID = '48eb1b36cf0202ab2ef07b880ecda60d';

export const LEGACY_SPOOF_APP_VERSION = '2.2.10.456537160';
export const LEGACY_SPOOF_USER_AGENT = 'Dalvik/2.1.0 (Linux; U; Android 12; SM-G991B Build/SP1A.210812.016)';
export const LEGACY_SPOOF_SYSTEM = 'android';
export const LEGACY_SPOOF_APP_PLATFORM = 'android';

export const LEGACY_AC_GENERIC_PRODUCT_IDS = [
  '000000000000000000000000c0620000',
  '0000000000000000000000002a4e0000',
];

export const LEGACY_AC_PARAMS = [
  'ac_astheat', 'ac_clean', 'ac_hdir', 'ac_health', 'ac_mark', 'ac_mode', 'ac_slp', 'ac_vdir',
  'ecomode', 'err_flag', 'mldprf', 'pwr', 'scrdisp', 'temp', 'envtemp', 'pwrlimit', 'pwrlimitswitch',
  'childlock', 'comfwind', 'new_type', 'ac_tempconvert', 'sleepdiy', 'ac_errcode1', 'tempunit', 'tenelec',
];

export const LEGACY_AC_SPECIAL_PARAMS = ['mode'];

export function isLegacyAcProduct(productId: string | undefined): boolean {
  return !!productId && LEGACY_AC_GENERIC_PRODUCT_IDS.includes(productId);
}

// Different numbering than the new backend's AuxMode/AuxFanSpeed in
// constants.ts -- do not mix the two tables.
export const LEGACY_MODE_TO_HOMEY: Record<number, string> = {
  4: 'auto',
  0: 'cool',
  2: 'dry',
  1: 'heat',
  3: 'fan',
};

export const HOMEY_MODE_TO_LEGACY: Record<string, number> = {
  auto: 4,
  cool: 0,
  dry: 2,
  heat: 1,
  fan: 3,
};

export const LEGACY_FAN_TO_HOMEY: Record<number, string> = {
  0: 'auto',
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'turbo',
  5: 'mute',
};

// The legacy backend has no medium_low/medium_high distinction -- map the
// closest neighbour.
export const HOMEY_FAN_TO_LEGACY: Record<string, number> = {
  auto: 0,
  low: 1,
  medium_low: 1,
  medium: 2,
  medium_high: 3,
  high: 3,
  turbo: 4,
  mute: 5,
};
