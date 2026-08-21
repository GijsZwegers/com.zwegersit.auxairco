export const AUX_HOST = 'https://eu-smthome-api.aux-global.com';
// Fallback only -- every request should pass a real country, see
// getCountryFromTimezone() below. Kept as NLD since that's the account this
// was originally built and tested against.
export const AUX_COUNTRY = 'NLD';
export const AUX_USER_AGENT = 'AUXAC/2.3.2 (iPhone; iOS 18.6.2; Scale/3.00)';

// The `country` header (ISO3) was hardcoded to NLD for every user until a
// Slovak user's login failed with "incorrect account or password" despite
// correct credentials -- the crypto is region-independent, so the most
// likely explanation is that AUX's backend uses this header to route the
// request to a region-specific keypair/user table, and a mismatched header
// breaks that. This maps the Homey's own timezone (this.homey.clock.
// getTimezone()) to the account's real country instead of assuming NL.
// Not exhaustive -- covers AUX's likely EU customer base; unmapped
// timezones fall back to AUX_COUNTRY.
const TIMEZONE_TO_COUNTRY: Record<string, string> = {
  'Europe/Amsterdam': 'NLD',
  'Europe/Brussels': 'BEL',
  'Europe/Berlin': 'DEU',
  'Europe/Paris': 'FRA',
  'Europe/Madrid': 'ESP',
  'Europe/Rome': 'ITA',
  'Europe/Lisbon': 'PRT',
  'Europe/Bratislava': 'SVK',
  'Europe/Prague': 'CZE',
  'Europe/Warsaw': 'POL',
  'Europe/Vienna': 'AUT',
  'Europe/Zurich': 'CHE',
  'Europe/Copenhagen': 'DNK',
  'Europe/Stockholm': 'SWE',
  'Europe/Oslo': 'NOR',
  'Europe/Helsinki': 'FIN',
  'Europe/Dublin': 'IRL',
  'Europe/London': 'GBR',
  'Europe/Budapest': 'HUN',
  'Europe/Bucharest': 'ROU',
  'Europe/Sofia': 'BGR',
  'Europe/Athens': 'GRC',
  'Europe/Zagreb': 'HRV',
  'Europe/Ljubljana': 'SVN',
  'Europe/Vilnius': 'LTU',
  'Europe/Riga': 'LVA',
  'Europe/Tallinn': 'EST',
  'Europe/Luxembourg': 'LUX',
  'Europe/Malta': 'MLT',
  'Europe/Nicosia': 'CYP',
  'Asia/Nicosia': 'CYP',
  'Atlantic/Reykjavik': 'ISL',
};

export function getCountryFromTimezone(timezone: string | undefined | null): string {
  if (!timezone) return AUX_COUNTRY;
  return TIMEZONE_TO_COUNTRY[timezone] ?? AUX_COUNTRY;
}

// Identifies the AC Freedom app itself, used only before login. Not a secret.
export const STATIC_APP_TOKEN =
  'MDczZTVlYzk2NTJjNGM2N2JjOWE1ZmI0YWU2NGRhMzZAZGUyMTRjNDZmOGY2NGZjMmEzNjQ1ODM5YmI1OTQyZjU=';

// Fixed AES-128-ECB key for the login 'account' (email) field, recovered from
// the AUX Home Android app.
export const ACCOUNT_AES_KEY = Buffer.from('4083aux63e3444a2', 'utf8');

export const AuxMode = {
  AUTO: 0,
  COOL: 1,
  DRY: 2,
  HEAT: 4,
  FAN: 6,
} as const;

export const HOMEY_MODE_TO_AUX: Record<string, number> = {
  auto: AuxMode.AUTO,
  cool: AuxMode.COOL,
  dry: AuxMode.DRY,
  heat: AuxMode.HEAT,
  fan: AuxMode.FAN,
};

export const AUX_MODE_TO_HOMEY: Record<number, string> = {
  [AuxMode.AUTO]: 'auto',
  [AuxMode.COOL]: 'cool',
  [AuxMode.DRY]: 'dry',
  [AuxMode.HEAT]: 'heat',
  [AuxMode.FAN]: 'fan',
};

export const AuxFanSpeed = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  MUTE: 3,
  AUTO: 4,
  TURBO: 5,
  MEDIUM_LOW: 6,
  MEDIUM_HIGH: 7,
} as const;

export const HOMEY_FAN_TO_AUX: Record<string, number> = {
  auto: AuxFanSpeed.AUTO,
  low: AuxFanSpeed.LOW,
  medium_low: AuxFanSpeed.MEDIUM_LOW,
  medium: AuxFanSpeed.MEDIUM,
  medium_high: AuxFanSpeed.MEDIUM_HIGH,
  high: AuxFanSpeed.HIGH,
  turbo: AuxFanSpeed.TURBO,
  mute: AuxFanSpeed.MUTE,
};

export const AUX_FAN_TO_HOMEY: Record<number, string> = {
  [AuxFanSpeed.AUTO]: 'auto',
  [AuxFanSpeed.LOW]: 'low',
  [AuxFanSpeed.MEDIUM_LOW]: 'medium_low',
  [AuxFanSpeed.MEDIUM]: 'medium',
  [AuxFanSpeed.MEDIUM_HIGH]: 'medium_high',
  [AuxFanSpeed.HIGH]: 'high',
  [AuxFanSpeed.TURBO]: 'turbo',
  [AuxFanSpeed.MUTE]: 'mute',
};

// A separate enum from AuxFanSpeed above: `status.control` byte 13 (top 3
// bits) reports fan speed using the old Broadlink wire values, not the
// wind_speed values from the intent API. No wire equivalent exists for
// medium_low/medium_high/mute, so reading those back isn't possible.
export const WIRE_FAN_TO_HOMEY: Record<number, string> = {
  1: 'high',
  2: 'medium',
  3: 'low',
  4: 'turbo',
  5: 'auto',
};
