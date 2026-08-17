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

## Requirements

- A Homey Pro
- An AUX Cloud account (the one used by the **AC Freedom** or **AUX Home**
  app) with an **email address set** — phone-only accounts can't log in here.
  Add an email via the AC Freedom/AUX Home app first if needed.

## Adding a device

1. Add a device, choose **AUX Airco**.
2. Enter your AUX Cloud email and password.
3. Select your air conditioner from the list.

Note: logging into the AC Freedom/AUX Home app on your phone can invalidate
other active sessions. If Homey loses its connection, it will automatically
log in again.

## Credits & how this works

The cloud protocol (login encryption, device list, control commands) was
reverse-engineered from scratch via network capture and by decompiling the
AUX Home Android app — full write-up and protocol notes in this project's
`protocol-test/` folder for anyone continuing this work. The status byte
layout turned out to share its structure with the older local Broadlink AC
protocol, so credit to the prior reverse-engineering work that made that
layout recognizable:

- [makleso6/broadlink-aircon-api](https://github.com/makleso6/broadlink-aircon-api) (Apache-2.0)
- [liaan/broadlink_ac_mqtt](https://github.com/liaan/broadlink_ac_mqtt)
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
