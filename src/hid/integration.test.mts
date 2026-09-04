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
  SaveTarget,
} from "./protocol/constants";

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
