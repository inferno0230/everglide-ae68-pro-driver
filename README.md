# Everglide AE68 Pro Web Driver

An unofficial, local web configurator for the **Everglide AE68 Pro** magnetic
keyboard. It communicates directly with the keyboard through WebHID—no vendor
account, telemetry, or remote configuration service required.

> [!IMPORTANT]
> This is an independent community project. It is not affiliated with or
> endorsed by Everglide, Sparklink, or PlayJoy. It currently targets the AE68
> Pro only.

## Features

- Run and monitor full-key switch calibration.
- Inspect firmware, protocol, board, connection, and lighting information.
- Explore the complete interface with a simulated keyboard.

The AE68 Pro exposes **184 addressable LEDs**: 72 north-facing key LEDs, 72
south-facing key LEDs, and a 40-LED bottom light bar. The spacebar accounts for
five LEDs on each face.

## Requirements

- An Everglide AE68 Pro connected over USB.
- A desktop Chromium browser with WebHID. Chrome and Edge are recommended.
- [Bun](https://bun.sh/) 1.4.1 or newer when running from source.

Firefox and Safari do not currently provide WebHID. A hosted copy must be
served over HTTPS; `localhost` is accepted as a secure development context.

## Run locally

```bash
git clone <repository-url>
cd everglide-ae68-pro-driver
bun install --frozen-lockfile
bun run dev
```

Open the local address printed by Vite, select **Choose keyboard**, and approve
the AE68 Pro in the browser's device picker. Permission is remembered for that
browser origin.

To inspect the interface without hardware, select **Open demo**. Demo data is
synthetic and no HID device is opened.

## Using the driver

1. Connect the keyboard over USB and close any other configurator that may be
   using it. Only one application can hold the HID interface at a time.
2. Choose the section you want from the sidebar.
5. Select **Save to keyboard** when finished.

Changes take effect immediately but initially live only in the keyboard's RAM.
They are lost when the keyboard loses power unless **Save to keyboard** writes
them to flash. Save before unplugging the board or switching profiles.

### Calibration

Start calibration, press every key fully down, and allow each key to return
fully. Finish the run only after all 68 keys have been exercised, then save the
calibration from the sidebar.

## Feature status

| Area | Status |
| --- | --- |
| Device discovery and information | Working |
| Calibration | Working |
| Simulated device | Working |

## TODO / not supported yet

- [ ] Add profile backup and restore to a local file.
- [ ] Add automated browser/UI tests in addition to protocol integration tests.
- [ ] Add a release/deployment workflow.
- [ ] Firmware update and recovery are intentionally unavailable. An incorrect
  firmware write can brick the keyboard, so this will remain unsupported until
  a safe and independently verified process exists.

Support for other keyboard models is not planned. The driver, protocol layer,
layout, and interface are intentionally specific to the Everglide AE68 Pro.

## Troubleshooting

**The keyboard does not appear in the picker**

- Confirm that it is connected by USB.
- Use Chrome or Edge on desktop.
- Close the vendor configurator and other copies of this driver.
- Reload the page, reconnect the cable, and try **Choose keyboard** again.

**Changes work but disappear after unplugging**

Select **Save to keyboard**. Until then, edits are active only in RAM.

**The page asks for permission again**

WebHID permission belongs to the exact browser origin. A different hostname or
development-server port counts as a different origin.

## Development

```bash
# Development server
bun run dev

# Type checking
bun run typecheck

# Protocol and simulated-device integration tests
bun run test

# Production build
bun run build

# Preview the production build
bun run preview
```

The production output is written to `dist/`. Device communication lives under
`src/hid/`, application state under `src/store/`, and the React interface under
`src/components/` and `src/sections/`.

## Safety and privacy

- The application talks only to a locally connected HID device.
- The source contains no analytics or network requests.
- Firmware flashing is not implemented.

## License

Released under the [MIT License](LICENSE).
