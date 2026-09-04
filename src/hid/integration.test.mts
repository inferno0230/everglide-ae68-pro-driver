/**
 * Drives the real Transport + Keyboard against the simulated board.
 *
 * This exercises framing, serialisation, prefix matching and every parser in
 * one pass — the parts that unit tests on individual builders cannot reach.
 */

import { strict as assert } from "node:assert";
import { Transport } from "./transport";
import { Keyboard } from "./keyboard";
import { createSimulatedDevice } from "./simulator";
import {
  AxisKind,
  HigherKeyMode,
  SaveTarget,
  SocdMode,
} from "./protocol/constants";
import { DksPosition, packDksTrigger, unpackDksTrigger } from "./protocol/higherkey";
import { describe as describeKey } from "./keycodes";
import { ledIndex, SPACEBAR_LED_COLUMNS } from "./protocol/lighting";

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n").slice(0, 3).join(" / ")}`);
  }
}

const transport = new Transport();
const keyboard = new Keyboard(transport);
await transport.open(createSimulatedDevice());

console.log("connect");

const snapshot = await keyboard.describe();

await check("reads protocol and firmware version", () => {
  assert.equal(snapshot.protocol.main, 1);
  assert.equal(snapshot.protocol.sub, 2);
  assert.equal(snapshot.info.appVersion, "0.1.4.0");
  assert.equal(snapshot.info.pcbVersion, "1-1-0-0");
});

await check("serial splits into its ASCII prefix and binary id", () => {
  // Not twelve decimal digits: printable prefix, then hex for the raw bytes.
  assert.equal(snapshot.info.serialNumber, "SIM001-1F930199A800");
});

await check("build timestamp reads all 16 bytes", () => {
  assert.equal(snapshot.info.buildTimestamp, "2026090111:40:23");
});

await check("feature flags match a magnetic USB board with RGB", () => {
  assert.equal(snapshot.feature.axis.magnetic, true);
  assert.equal(snapshot.feature.connection.usb, true);
  assert.equal(snapshot.feature.basic.rgb, true);
  assert.equal(snapshot.feature.extended.smallScreen, false);
});

console.log("layout");

await check("discovers 68 keys across matrix rows 1-5", () => {
  assert.equal(snapshot.keys.length, 68, "AE68 Pro has 68 keys");
  assert.deepEqual(snapshot.rows, [1, 2, 3, 4, 5]);
});

await check("per-row key counts are 15, 15, 14, 14, 10", () => {
  const counts = snapshot.rows.map(
    (r) => snapshot.keys.filter((k) => k.row === r).length,
  );
  assert.deepEqual(counts, [15, 15, 14, 14, 10]);
});

await check("bottom row resolves to sparse electrical columns", () => {
  const bottom = snapshot.keys
    .filter((k) => k.row === 5)
    .sort((a, b) => a.x - b.x)
    .map((k) => k.col);
  assert.deepEqual(bottom, [0, 1, 2, 6, 9, 10, 11, 12, 13, 14]);
});

await check("space is addressable at its electrical column, not its x", async () => {
  const space = snapshot.keys.find((k) => k.row === 5 && k.x === 3.75);
  assert.ok(space, "space should sit at x=3.75");
  assert.equal(space?.col, 6, "space is electrical column 6");
  const map = await keyboard.keymap(0, 5);
  assert.equal(map[6], 44, "column 6 holds the Space keycode");
});

console.log("keymap");

await check("layer 0 reads back real keycodes", async () => {
  const row = await keyboard.keymap(0, 3);
  assert.equal(describeKey(row[1] ?? 0), "A");
  assert.equal(describeKey(row[12] ?? 0), "Enter");
});

await check("writing a keycode round-trips", async () => {
  await keyboard.setKeycode(0, 3, 1, 0x1808); // Win+E on the A key
  const row = await keyboard.keymap(0, 3);
  assert.equal(row[1], 0x1808);
  assert.equal(describeKey(row[1] ?? 0), "Win+E");
  await keyboard.setKeycode(0, 3, 1, 4); // put A back
});

await check("Fn1 layer carries its own mapping", async () => {
  const row = await keyboard.keymap(1, 1);
  assert.equal(describeKey(row[1] ?? 0), "F1");
});

console.log("performance");

await check("reads a key's actuation record", async () => {
  const p = await keyboard.performance(3, 1);
  assert.equal(p.press, 1200);
  assert.equal(p.axisRangeMax, 4000);
});

await check("write returns the firmware's clamped value, not ours", async () => {
  const before = await keyboard.performance(3, 1);
  // Fixed mode: ask for a reset point different from the actuation point.
  const sent = { ...before, mode: 0 as const, press: 1500, release: 900 };
  const got = await keyboard.setPerformance(3, 1, sent);
  assert.equal(got.press, 1500);
  assert.equal(
    got.release,
    1500,
    "fixed mode collapses release onto press — the reply is the truth",
  );
});

await check("rapid trigger keeps an independent reset point", async () => {
  const before = await keyboard.performance(3, 2);
  const got = await keyboard.setPerformance(3, 2, {
    ...before,
    mode: 1,
    press: 1000,
    release: 700,
  });
  assert.equal(got.mode, 1);
  assert.equal(got.release, 700);
});

await check("calibration constants survive a write", async () => {
  const before = await keyboard.performance(3, 3);
  const got = await keyboard.setPerformance(3, 3, { ...before, press: 800 });
  assert.equal(got.axisV2Id, before.axisV2Id);
  assert.equal(got.axisRangeMax, before.axisRangeMax);
  assert.equal(got.axisCoefficient, before.axisCoefficient);
});

console.log("telemetry");

await check("axis polling returns one reading per column", async () => {
  const adc = await keyboard.axisData(AxisKind.Adc, 3);
  const populated = adc.filter((v) => v > 0);
  assert.equal(populated.length, 14, "row 3 has 14 keys");
  assert.ok(
    populated.every((v) => v > 2300 && v < 2400),
    "resting ADC sits near 2340",
  );
});

await check("interleaved row polls do not cross replies", async () => {
  // Four rows in flight at once: only kind+row disambiguates these, so this is
  // the case that breaks a transport matching on two bytes.
  const [r2, r3, r4, r5] = await Promise.all([
    keyboard.axisData(AxisKind.Route, 2),
    keyboard.axisData(AxisKind.Route, 3),
    keyboard.axisData(AxisKind.Route, 4),
    keyboard.axisData(AxisKind.Route, 5),
  ]);
  assert.equal(r2.length, 30);
  assert.equal(r3.length, 30);
  assert.equal(r4.length, 30);
  assert.equal(r5.length, 30);
});

console.log("lighting");

const kb = keyboard;
const keyboard0 = () => kb.lightingBase(0);
const keyboard1 = () => kb.lightingBase(1);

await check("reads the base lighting record", async () => {
  const base = await keyboard.lightingBase();
  assert.equal(base.open, 3, "both faces lit");
  assert.equal(base.brightness, 80);
});

await check("lighting write round-trips through the reply", async () => {
  const base = await keyboard.lightingBase();
  const got = await keyboard.setLightingBase({
    ...base,
    effect: 0,
    brightness: 55,
    paletteSlot: 2,
  });
  assert.equal(got.effect, 0);
  assert.equal(got.brightness, 55);
  assert.equal(got.paletteSlot, 2);
});

await check("palette slot 0 is the cycle-hues slot, stored as black", async () => {
  const palette = await keyboard.palette();
  assert.equal(palette.length, 8);
  assert.deepEqual(
    { r: palette[0]?.r, g: palette[0]?.g, b: palette[0]?.b },
    { r: 0, g: 0, b: 0 },
    "slot 0 is stored as {0,0,0} and must not render as a black swatch",
  );
  assert.equal(palette[1]?.r, 247, "slot 1 carries a real colour");
});

await check("the light bar keeps lighting separate from the keyboard", async () => {
  // Give each area a distinct setting, then check neither leaks into the other.
  const keyboard = await kb.setLightingBase(
    { ...(await keyboard0()), effect: 9, brightness: 90 },
    0,
  );
  const bar = await kb.setLightingBase(
    { ...(await keyboard1()), effect: 3, brightness: 40 },
    1,
  );

  assert.equal(keyboard.effect, 9);
  assert.equal(bar.effect, 3, "the bar holds its own effect");
  assert.equal(bar.brightness, 40, "and its own brightness");
  assert.deepEqual(
    await keyboard0(),
    keyboard,
    "writing the bar left the keyboard untouched",
  );
});

await check("the bar is a plain on/off, the keyboard a face bitfield", async () => {
  // Keyboard: north and south are independent bits of the same byte.
  const kbBase = await kb.lightingBase(0);
  const northOnly = await kb.setLightingBase({ ...kbBase, open: 2 }, 0);
  assert.equal(northOnly.open, 2, "north only");
  const both = await kb.setLightingBase({ ...kbBase, open: 3 }, 0);
  assert.equal(both.open, 3, "both faces");

  // Bar: 1 is simply on.
  const barBase = await kb.lightingBase(1);
  const on = await kb.setLightingBase({ ...barBase, open: 1 }, 1);
  assert.equal(on.open, 1);
});

await check("palettes are stored per area", async () => {
  const before = await kb.palette(1);
  const next = before.map((s, i) => (i === 3 ? { ...s, r: 1, g: 2, b: 3 } : s));
  await kb.setPalette(next, 1);

  const bar = await kb.palette(1);
  const keyboard = await kb.palette(0);
  assert.deepEqual(
    { r: bar[3]?.r, g: bar[3]?.g, b: bar[3]?.b },
    { r: 1, g: 2, b: 3 },
    "the bar took the new colour",
  );
  assert.notDeepEqual(
    keyboard[3],
    bar[3],
    "the keyboard palette is untouched",
  );
});

await check("per-key colour is addressed on a 21-slot row pitch", async () => {
  // Esc is row 1 col 0 and the right arrow row 5 col 14 -- the two the vendor's
  // own paint tool was watched landing on slots 21 and 119.
  assert.equal(ledIndex(1, 0), 21);
  assert.equal(ledIndex(5, 14), 119);

  await keyboard.setCustomColors(
    new Map([
      ["1:0", { r: 255, g: 255, b: 255 }],
      ["5:14", { r: 0, g: 128, b: 255 }],
    ]),
  );

  const back = await keyboard.customColors();
  assert.equal(back.size, 2, "only the two painted keys are custom");
  assert.deepEqual(back.get("1:0"), { r: 255, g: 255, b: 255 });
  assert.deepEqual(back.get("5:14"), { r: 0, g: 128, b: 255 });
});

await check("one spacebar paint controls its five north/south LED pairs", async () => {
  const spaceColor = { r: 84, g: 31, b: 219 };
  await keyboard.setCustomColors(new Map([["5:6", spaceColor]]));

  const buffer = await keyboard.keyColorBuffer();
  for (const col of SPACEBAR_LED_COLUMNS) {
    const led = buffer[ledIndex(5, col)];
    assert.equal(led?.custom, true, `spacebar LED column ${col} is pinned`);
    assert.deepEqual(
      led && { r: led.r, g: led.g, b: led.b },
      spaceColor,
      `spacebar LED column ${col} has the selected colour`,
    );
  }
  assert.equal(buffer[ledIndex(5, 3)]?.custom, false, "left neighbour is untouched");
  assert.equal(buffer[ledIndex(5, 9)]?.custom, false, "right neighbour is untouched");

  const back = await keyboard.customColors();
  assert.equal(back.size, 1, "the five slots reconcile as one logical key");
  assert.deepEqual(back.get("5:6"), spaceColor);
});

await check("the light bar exposes 40 contiguous addressable LEDs", async () => {
  const topology = { rows: 1, cols: 40 };
  await keyboard.setCustomColors(
    new Map([
      ["0:0", { r: 255, g: 32, b: 0 }],
      ["0:39", { r: 0, g: 64, b: 255 }],
    ]),
    1,
    topology,
  );

  const back = await keyboard.customColors(1, topology);
  assert.equal(back.size, 2, "only the two painted bar LEDs are custom");
  assert.deepEqual(back.get("0:0"), { r: 255, g: 32, b: 0 });
  assert.deepEqual(back.get("0:39"), { r: 0, g: 64, b: 255 });
  assert.equal(
    (await keyboard.keyColorBuffer(1, topology)).length,
    45,
    "the 40-LED bar needs three protocol pages",
  );
});

await check("a key left out of the map is handed back to the effect", async () => {
  await keyboard.setCustomColors(new Map([["1:0", { r: 9, g: 9, b: 9 }]]));
  const back = await keyboard.customColors();
  assert.deepEqual([...back.keys()], ["1:0"]);

  await keyboard.setCustomColors(new Map());
  assert.equal((await keyboard.customColors()).size, 0);
});

await check("the six padding slots per row drive nothing", async () => {
  // Column 15 is inside the 21-slot row but past the 15 real LEDs; the board
  // drops it, so the buffer must never place a key there.
  const buffer = await keyboard.keyColorBuffer();
  assert.equal(buffer.length, 135, "9 pages of 15");
  assert.equal(buffer[ledIndex(0, 15)]?.custom, false);
});

await check("direct drive sends without waiting for a reply", async () => {
  const colors = Array.from({ length: 68 }, () => ({
    r: 255, g: 0, b: 0, custom: true,
  }));
  // Would hang or throw if the transport expected an answer.
  await keyboard.driveKeyColors(colors);
});

console.log("profiles and save");

await check("reads four profiles and the active one", () => {
  assert.equal(snapshot.profiles.length, 4);
  assert.equal(snapshot.profiles[0]?.name, "Config 1");
  assert.equal(snapshot.activeProfile, 0);
});

await check("save targets are accepted", async () => {
  await keyboard.save(SaveTarget.Performance);
  await keyboard.save(SaveTarget.All);
});

console.log("advanced keys");

// PgUp and PgDn — the two keys with nothing bound to them on this board.
const A = { row: 3, col: 14 };
const B = { row: 4, col: 14 };

await check("an untouched key has no advanced behaviour", async () => {
  const record = await keyboard.higherKey(A);
  assert.equal(record?.mode, HigherKeyMode.None);
});

await check("DKS round-trips, position 3 included", async () => {
  // Positions 0 and 3 — the transcript captured from the vendor's app.
  const triggers = packDksTrigger([DksPosition.PressMin, DksPosition.HoldBottom]);
  assert.equal(triggers, 0x19, "0x01 | 0x08 | 0x10");

  await keyboard.setDks(A, {
    keycodes: [4, 0, 0, 0],
    triggers: [triggers, 0, 0, 0],
    minTravel: 1500,
    maxTravel: 3000,
  });

  const record = await keyboard.higherKey(A);
  assert.equal(record?.mode, HigherKeyMode.DKS);
  if (record?.mode !== HigherKeyMode.DKS) return;
  assert.deepEqual(record.data.keycodes, [4, 0, 0, 0]);
  assert.equal(record.data.minTravel, 1500);
  assert.equal(record.data.maxTravel, 3000);
  assert.deepEqual(unpackDksTrigger(record.data.triggers[0]), [
    DksPosition.PressMin,
    DksPosition.HoldBottom,
  ]);
});

await check("MPT keeps its depths in micrometres", async () => {
  await keyboard.setMpt(A, {
    keycodes: [75, 0, 0],
    depths: [500, 1000, 1500],
  });
  const record = await keyboard.higherKey(A);
  if (record?.mode !== HigherKeyMode.MPT) throw new Error("not MPT");
  assert.deepEqual(record.data.depths, [500, 1000, 1500]);
});

await check("MT, TGL and END round-trip their timings", async () => {
  await keyboard.setMt(A, { tap: 75, hold: 224, holdTime: 200 });
  let record = await keyboard.higherKey(A);
  if (record?.mode !== HigherKeyMode.MT) throw new Error("not MT");
  assert.equal(record.data.holdTime, 200);

  await keyboard.setTgl(A, { keycode: 75, time: 0 });
  record = await keyboard.higherKey(A);
  if (record?.mode !== HigherKeyMode.TGL) throw new Error("not TGL");
  assert.equal(record.data.keycode, 75);

  await keyboard.setEnd(A, { keycodes: [75, 78], delay: 12 });
  record = await keyboard.higherKey(A);
  if (record?.mode !== HigherKeyMode.END) throw new Error("not END");
  assert.deepEqual(record.data.keycodes, [75, 78]);
  assert.equal(record.data.delay, 12);
});

await check("SOCD writes both keys, with the keycodes swapped", async () => {
  await keyboard.setSocd(A, {
    other: B,
    keycodes: [75, 78],
    delay: 0,
    resolution: SocdMode.PriorityA,
  });

  const first = await keyboard.higherKey(A);
  const second = await keyboard.higherKey(B);
  if (first?.mode !== HigherKeyMode.SOCD || second?.mode !== HigherKeyMode.SOCD) {
    throw new Error("both keys should carry the pair");
  }
  assert.deepEqual(first.data.other, B);
  assert.deepEqual(second.data.other, A);
  assert.deepEqual(first.data.keycodes, [75, 78]);
  assert.deepEqual(second.data.keycodes, [78, 75], "packet B swaps them");
  // A Priority is asymmetric: 1 to the first key, 2 to the second.
  assert.equal(first.data.resolution, 1);
  assert.equal(second.data.resolution, 2);
});

await check("clearing a key returns it to plain behaviour", async () => {
  await keyboard.clearHigherKey(A);
  await keyboard.clearHigherKey(B);
  assert.equal((await keyboard.higherKey(A))?.mode, HigherKeyMode.None);
  assert.equal((await keyboard.higherKey(B))?.mode, HigherKeyMode.None);
});

await check("device reports zone topology and dual lighting", () => {
  assert.equal(snapshot.ledZones.length, 2);
  assert.equal(snapshot.ledZones[0]?.effectCount, 20, "the keyboard offers 20 effects");
  assert.equal(snapshot.ledZones[1]?.cols, 40, "40-LED light bar");
  assert.equal(snapshot.dualLighting, true);
  assert.equal(snapshot.rtPrecisionMm, 0.01);
});

await transport.close();

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
