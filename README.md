# Everglide AE68 Pro Web Driver

An unofficial, local web configurator for the **Everglide AE68 Pro** magnetic
keyboard. It communicates directly with the keyboard through WebHID—no vendor
account, telemetry, or remote configuration service required.

**[Open the hosted driver](https://inferno0230.github.io/everglide-ae68-pro-driver/)**

> [!IMPORTANT]
> This is an independent community project. It is not affiliated with or
> endorsed by Everglide, Sparklink, or PlayJoy. It currently targets the AE68
> Pro only.

## Features

- Configure fixed actuation, rapid trigger, press/reset points, and dead zones
  per key or across multiple selected keys.
- View live switch travel for all 68 keys.
- Remap four layers: Main, Fn1, Fn2, and Fn3.
- Assign keyboard, media, mouse, control, lighting, and gamepad keycodes.
- Configure DKS, MPT, tap-or-hold (MT), Toggle, End Trigger, SOCD, and
  Rappy-Snappy.
- Run and monitor full-key switch calibration.
- Control keyboard and bottom-lighting effects, brightness, speed, direction,
  and palette.
- Paint individual north/south key LEDs and all 40 bottom light-bar LEDs.
- Switch and rename the keyboard's four onboard profiles.
- Select report rates from 250 Hz to 8 kHz.
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
3. Select one or more keys where applicable, then adjust their settings.
4. Check the value shown after a write. The firmware may clamp unsupported
   values; the driver displays what the keyboard actually returned.
5. Select **Save to keyboard** when finished.

Changes take effect immediately but initially live only in the keyboard's RAM.
They are lost when the keyboard loses power unless **Save to keyboard** writes
them to flash. Save before unplugging the board or switching profiles.

### Performance

Select keys on the keyboard preview, choose fixed actuation or rapid trigger,
and adjust the available travel and dead-zone controls. **Live travel** polls
the switches at 20 Hz and displays their current depth on the keyboard.

### Keymap

Choose a layer, select a key, and assign its new action. Available assignments
are grouped into keyboard, media, mouse, control, lighting, and gamepad
categories. Keyboard assignments are further arranged as letters, numbers,
symbols, function keys, and extra keys.

### Lighting

The keyboard and bottom light bar are separate lighting areas. Effect settings
are rendered by the keyboard itself; the preview intentionally shows only
colours explicitly assigned to individual keys or LEDs.

Enable **Per-key colour** or **Per-LED colour** to reveal the addressable
preview. Drag to paint and right-click an address to return it to the active
effect. The keyboard supports interactive modes L18–L20: pressed region,
vertical column, and water-ripple reactions.

### Advanced keys

Select a key and configure DKS, MPT, tap-or-hold (MT), Toggle, End Trigger,
SOCD, or Rappy-Snappy. Pair-based modes update both involved keys together.
Review the draft and confirm it before saving the result to flash.

### Calibration

Start calibration, press every key fully down, and allow each key to return
fully. Finish the run only after all 68 keys have been exercised, then save the
calibration from the sidebar.

### Device settings

The Device page shows hardware information, profile names, and report rate.
Changing report rate restarts the keyboard's USB connection. The driver waits
for it to return, reconnects automatically, and reloads the current state. If
it does not return within 12 seconds, reconnect it from the device picker.

Supported rates are 250 Hz, 500 Hz, 1 kHz, 2 kHz, 4 kHz, and 8 kHz. The
keyboard does not provide a 125 Hz mode.

## Feature status

| Area | Status |
| --- | --- |
| Device discovery and information | Working |
| Performance and rapid trigger | Working |
| Live switch travel | Working |
| Four-layer keymap | Working |
| Keyboard and bottom RGB | Working |
| Per-key/per-LED colour | Working |
| Advanced key behaviours | Working |
| Calibration | Working |
| Profiles and profile names | Working |
| Report-rate changes and automatic reconnect | Working |
| Simulated device | Working |

## TODO / not supported yet

- [ ] Build the macro editor. The 16-slot macro protocol is implemented and
  tested in the driver, but there is no interface for it yet.
- [ ] Add profile backup and restore to a local file.
- [ ] Add automated browser/UI tests in addition to protocol integration tests.
- [ ] Add a release/deployment workflow.
- [ ] Firmware update and recovery are intentionally unavailable. An incorrect
  firmware write can brick the keyboard, so this will remain unsupported until
  a safe and independently verified process exists.

Support for other keyboard models is not planned. The driver, protocol layer,
layout, and interface are intentionally specific to the Everglide AE68 Pro.

## Troubleshooting

**The keyboard does not appear in the picker or cannot connect**

- Confirm that it is connected by USB.
- Use Chrome or Edge on desktop.
- Close the vendor configurator and other copies of this driver.
- Reload the page, reconnect the cable, and try **Choose keyboard** again.

### Linux permissions

On Linux, the keyboard may appear in the browser's picker and remain paired,
but the driver can still fail to open it when the current user cannot access
its vendor `hidraw` interface. First find the keyboard's vendor and product IDs
in the `vvvv:pppp` column printed by `lsusb`, then match them to its `hidraw`
nodes:

```bash
lsusb

for device in /dev/hidraw*; do
  echo "$device"
  udevadm info --query=property --name="$device" \
    | grep -E '^(ID_MODEL|ID_VENDOR_ID|ID_MODEL_ID|ID_USB_INTERFACE_NUM)='
done
```

A matching `lsusb` line looks like this:

```text
Bus 003 Device 003: ID abcd:1234 Keyboard Manufacturer Keyboard Name
```

In that example, `VVVV` is `abcd` and `PPPP` is `1234`. If you cannot tell
which line belongs to the keyboard, run `lsusb` once with it unplugged and
again after reconnecting it; the new line contains the IDs to use. The
`ID_VENDOR_ID` and `ID_MODEL_ID` values from the matching `hidraw` entry should
show the same two IDs.

If the keyboard's nodes are owned by `root:root` with mode `0600`, install a
udev rule that grants the active desktop user access. Replace `VVVV` and `PPPP`
below with the lowercase vendor and product IDs reported for your keyboard:

```bash
printf '%s\n' \
'SUBSYSTEM=="hidraw", KERNEL=="hidraw*", ATTRS{idVendor}=="VVVV", ATTRS{idProduct}=="PPPP", TAG+="uaccess"' \
| sudo tee /etc/udev/rules.d/70-everglide-ae68-pro.rules

sudo udevadm control --reload-rules
```

Unplug and reconnect the keyboard, then reload the page and choose it again.
You can confirm the result with `getfacl /dev/hidrawN`, replacing `N` with one
of the keyboard's node numbers; your user should have `rw-` access.

**Changes work but disappear after unplugging**

Select **Save to keyboard**. Until then, edits are active only in RAM.

**The page asks for permission again**

WebHID permission belongs to the exact browser origin. A different hostname or
development-server port counts as a different origin.

**The keyboard disappears after changing report rate**

A short USB restart is expected. Wait for automatic reconnection. If the error
screen remains after 12 seconds, choose the keyboard again.

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
- Factory-reset actions affect the selected keyboard configuration and should
  be used deliberately.

## License

Released under the [MIT License](LICENSE).
