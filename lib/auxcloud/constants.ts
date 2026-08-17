// AUX Cloud protocolconstanten, geverifieerd tegen de echte airco op 2026-08-12.
// Zie C:\Work\Homey\protocol-test\CLOUD-PROTOCOL-NOTES.md voor de volledige
// uitleg van hoe deze gevonden zijn.

export const AUX_HOST = 'https://eu-smthome-api.aux-global.com';
export const AUX_COUNTRY = 'NLD';
export const AUX_USER_AGENT = 'AUXAC/2.3.2 (iPhone; iOS 18.6.2; Scale/3.00)';

// Statische app-token -- identificeert de AC Freedom-app zelf, gebruikt vóór
// login. Geen persoonlijk geheim.
export const STATIC_APP_TOKEN =
  'MDczZTVlYzk2NTJjNGM2N2JjOWE1ZmI0YWU2NGRhMzZAZGUyMTRjNDZmOGY2NGZjMmEzNjQ1ODM5YmI1OTQyZjU=';

// Vaste AES-128-ECB-sleutel voor het 'account'-veld (e-mailadres) bij login.
// Gevonden door de AUX Home Android-app te decompileren (klasse b1.b),
// geverifieerd tegen een echte capture.
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

// Let op: dit is een ANDER enum dan AuxFanSpeed hierboven! `status.control`
// byte 13 (top 3 bits, >>5) gebruikt de oude Broadlink wire-protocol-waarden,
// niet de wind_speed-waarden van de intent-API. Bevestigd (2026-08-12) met 3
// losse metingen (auto/high/medium). Geen wire-equivalent gevonden voor
// medium_low/medium_high/mute -- die vallen bij het uitlezen terug op de
// dichtstbijzijnde bekende stand.
export const WIRE_FAN_TO_HOMEY: Record<number, string> = {
  1: 'high',
  2: 'medium',
  3: 'low',
  4: 'turbo',
  5: 'auto',
};
