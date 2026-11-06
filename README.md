# AUX Airco for Homey

Control your AUX Freedom split-unit air conditioner from Homey. Built by
reverse-engineering the AC Freedom / AUX Home cloud API — there is no
official AUX integration for Homey, so this fills that gap for the
[Homey community](https://community.homey.app/t/aux-airco-control-with-homey/66666)
that's been asking for one since 2022.

## Features

- **Power** on/off
- **Mode**: auto, cool, heat, dry, fan
- **Target temperature**, including half-degree steps (16–32°C)
- **Measured room temperature** (whole degrees)
- **Fan speed**: auto, low, medium-low, medium, medium-high, high, turbo, mute
- Live status polling (every 60s) keeps Homey in sync with the AC
- Automatically falls back to AUX's older Broadlink-hosted cloud backend at
  pairing time for accounts/units that don't exist on the newer one — no
  need to know in advance which backend your account is on

## Known limitations

This app talks to AUX's cloud API, reverse-engineered from network traffic
and the AUX Home Android app (see [Credits](#credits--how-this-works)). Some
things aren't fully solved yet:

- **Swing status** can be *set*, but reading the current position back from
  the AC (and telling vertical apart from horizontal swing) isn't reliable
  yet, so the app doesn't sync this from the physical remote/other apps.
- Only tested against a single AUX Freedom 5.0kW split unit. Other
  AUX-branded models (rebrands: Dunham, Rcool, Akai, Tornado, Ballu, ...)
  using the same `aux-global.com` backend will likely work but are untested.
- **Local (LAN) control isn't supported.** Some older AUX Wi-Fi modules speak
  a local Broadlink-style protocol; this specific unit doesn't respond to it,
  so this app is cloud-only.
- The legacy-backend fallback (see Features) is untested against a real
  account on that backend — it was built from a public reference
  implementation, not verified end-to-end. If pairing fails on a unit that
  works fine in the official app, please open an issue.

## Requirements

- A Homey Pro
- An AUX Cloud account (the one used by the **AC Freedom** or **AUX Home**
  app) with an **email address set** — phone-only accounts can't log in here.
  Add an email via the AC Freedom/AUX Home app first if needed.

**Use a separate AUX guest account for Homey if you also use the phone app.**
Create a second AUX account with its own email address and password. Share
the air conditioner from your main account with that guest account in
AC Freedom/AUX Home, accept the invitation if required, and verify that
the guest can see the air conditioner. Use the guest credentials in Homey
and keep the main account in the phone app. These are two AUX accounts,
not Homey users. Using the same account in both apps can invalidate
Homey's session. Sharing options may vary between app versions/accounts.

## Adding a device

1. Add a device, choose **AUX Airco**.
2. Read the compatibility and guest-account instructions, then enter your
   AUX guest account's email and password.
3. Select your air conditioner from the list.

## Login problems and repairing

Homey stops automatic login attempts after rejected credentials, a lockout
warning, or a locked account. The device shows an actionable message and
Homey creates one timeline notification per account incident. The pause
survives app restarts and is shared by devices using the same cloud account.
Flows and manual controls cannot bypass it.

For a lockout or warning, wait at least ten minutes without login attempts.
Check the account in AC Freedom/AUX Home, then open the air conditioner's
settings in Homey and choose its repair option to sign in again. Waiting
alone does not resume automatic login attempts. Repair checks that the
account can access the existing air conditioner before saving credentials,
so the device ID and its Flows are preserved. A password update also updates
other devices using the same account; switching to a different guest
account changes only the repaired device.

Temporary network/server errors are retried on the next status poll without
an extra password login. Recognized expired-session errors permit one
re-authentication and request retry. Devices on the same account share a
session and in-flight login, avoiding competing logins.

## Credits & how this works

The cloud protocol (login encryption, device list, control commands) was
reverse-engineered from scratch via network capture and by decompiling the
AUX Home and AC Freedom Android apps — full write-up and protocol notes in
this project's `protocol-test/` folder for anyone continuing this work. The
status byte layout on the current backend turned out to share its structure
with the older local Broadlink AC protocol, so credit to the prior
reverse-engineering work that made that layout recognizable:

- [makleso6/broadlink-aircon-api](https://github.com/makleso6/broadlink-aircon-api) (Apache-2.0)
- [liaan/broadlink_ac_mqtt](https://github.com/liaan/broadlink_ac_mqtt)

The legacy-backend fallback (`lib/auxcloud/legacyClient.ts`,
`legacyConstants.ts`) is a direct TypeScript port of the login/device/control
logic from these two MIT-licensed projects, which target that older backend
natively:

- [fparrav/homebridge-aux-cloud](https://github.com/fparrav/homebridge-aux-cloud) (MIT)
- [maeek/ha-aux-cloud](https://github.com/maeek/ha-aux-cloud) (MIT)

## Contributing

Issues and PRs welcome — in particular, help nailing down separate
vertical/horizontal swing status reading would be very welcome (see
`protocol-test/CLOUD-PROTOCOL-NOTES.md`).

If this app is useful to you, this was built entirely in evenings as a
hobby project — donations are welcome but never required.

## License

MIT — see [LICENSE](LICENSE).
