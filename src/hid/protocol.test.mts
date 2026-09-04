/**
 * Self-checks for the wire format, run with `bun run test:protocol`.
 *
 * These assert against the worked examples in .codex/reverse/PROTOCOL.md, so they
 * catch a packing regression without needing the keyboard plugged in.
 */

import { strict as assert } from "node:assert";
import { pad64, readU16, u16le, mmToUm } from "./codec";
import * as layout from "./protocol/layout";
import * as perf from "./protocol/performance";
import * as adv from "./protocol/higherkey";
import * as mac from "./protocol/macro";
import { HigherKeyMode, SocdMode } from "./protocol/constants";
import { decodeCombo, describe as describeKey, macroKeycode } from "./keycodes";

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(err as Error).message.split("\n")[0]}`);
  }
}

console.log("codec");

check("pad64 zero-fills to exactly 64 bytes", () => {
  const r = pad64([4, 1, 2]);
  assert.equal(r.length, 64);
  assert.deepEqual(Array.from(r.subarray(0, 4)), [4, 1, 2, 0]);
});

check("u16 round-trips little-endian", () => {
  const [lo, hi] = u16le(0xf101);
  assert.deepEqual([lo, hi], [0x01, 0xf1]);
  assert.equal(readU16(Uint8Array.from([lo, hi]), 0), 0xf101);
});

check("travel converts mm to micrometres", () => {
  assert.equal(mmToUm(1.5), 1500);
  assert.equal(mmToUm(0.1), 100);
});

console.log("layout");

check("bottom-row columns resolve past the wide-key gap", () => {
  // PROTOCOL.md section 5, worked example. Ten physical keys, but the drawing
  // coordinates skip: floor(x) would give [0,1,2,3,10,11,12,13,14,15].
  const keycodes = [224, 227, 226, 0, 0, 0, 44, 0, 0, 230, 0xf101, 228, 80, 81, 79];
  const keys = [0, 1, 2, 3, 10, 11, 12, 13, 14, 15].map((x) => ({
    row: 5,
    col: Math.floor(x),
    x,
    ratio: 4,
  }));

  const resolved = layout.resolveColumns(keys, keycodes);
  assert.deepEqual(
    resolved.map((k) => k.col),
    [0, 1, 2, 6, 9, 10, 11, 12, 13, 14],
    "space must land on electrical column 6",
  );
});

check("mismatched counts fall back to floor(x)", () => {
  const keys = [{ row: 5, col: 0, x: 0, ratio: 4 }];
  const resolved = layout.resolveColumns(keys, [1, 2, 3]);
  assert.equal(resolved[0]?.col, 0);
});

check("layout style unpacks packed u16 fields", () => {
  // s=20 (matrixRow 5), l=24 (x 6), ratio 4
  const packed = (20 << 11) | (24 << 4) | 4;
  const report = pad64([3, 5, 5, packed & 0xff, packed >> 8]);
  const [key] = layout.parseKeyLayoutStyle(report);
  assert.equal(key?.row, 5);
  assert.equal(key?.x, 6);
  assert.equal(key?.ratio, 4);
});

check("0xFF marks an unused row", () => {
  assert.deepEqual(layout.parseKeyLayoutStyle(pad64([3, 5, 0xff])), []);
});

console.log("performance");

check("performance set/parse round-trips", () => {
  const written: perf.Performance = {
    mode: 1,
    press: 1200,
    release: 800,
    rtFirst: 300,
    rtPress: 150,
    rtRelease: 150,
    pressDead: 100,
    releaseDead: 200,
    axis: 3,
    calibrate: 1,
    axisV2Id: 7,
    axisRangeMax: 4000,
    axisCoefficient: 1024,
  };
  // The reply has the same field layout as the request, so parsing our own
  // packet back is a real check of both directions.
  const packet = perf.setPerformance(5, 6, written);
  assert.deepEqual(perf.parsePerformance(packet), written);
  assert.deepEqual(Array.from(packet.subarray(0, 4)), [4, 2, 5, 6]);
});

console.log("advanced keys");

check("DKS position 3 occupies two bits", () => {
  assert.equal(adv.packDksTrigger([adv.DksPosition.HoldBottom]), 0x18);
  assert.deepEqual(adv.unpackDksTrigger(0x18), [adv.DksPosition.HoldBottom]);
  // One of the two bits alone must not decode as position 3.
  assert.deepEqual(adv.unpackDksTrigger(0x08), []);
});

check("DKS trigger bitfield round-trips", () => {
  const positions = [
    adv.DksPosition.PressMin,
    adv.DksPosition.HoldBottom,
    adv.DksPosition.ReleaseMin,
  ];
  assert.equal(adv.packDksTrigger(positions), 0x01 | 0x18 | 0x80);
  assert.deepEqual(adv.unpackDksTrigger(adv.packDksTrigger(positions)), positions);
});

check("DKS set/parse round-trips", () => {
  const data: adv.DksConfig = {
    keycodes: [4, 5, 6, 7],
    triggers: [0x01, 0x02, 0x18, 0x80],
    minTravel: 1500,
    maxTravel: 3000,
  };
  const parsed = adv.parseHigherKey(adv.setDks({ row: 2, col: 3 }, data));
  assert.equal(parsed?.mode, HigherKeyMode.DKS);
  assert.deepEqual(parsed && "data" in parsed ? parsed.data : null, data);
  assert.equal(parsed?.row, 2);
  assert.equal(parsed?.col, 3);
});

check("SOCD writes two packets with swapped keycodes", () => {
  const key = { row: 3, col: 1 };
  const other = { row: 3, col: 3 };
  const [a, b] = adv.setSocd(key, {
    other,
    keycodes: [0x04, 0x07],
    delay: 20,
    resolution: SocdMode.PriorityA,
  });

  // Packet A is registered from `key`, and names `other` as its partner.
  assert.deepEqual(Array.from(a.subarray(0, 7)), [6, 2, 3, 1, 6, 3, 3]);
  assert.equal(readU16(a, 7), 0x04);
  assert.equal(readU16(a, 9), 0x07);
  assert.equal(a[13], 1, "packet A takes the first resolution byte");

  // Packet B is the mirror: keys swapped, keycodes swapped, other resolution.
  assert.deepEqual(Array.from(b.subarray(0, 7)), [6, 2, 3, 3, 6, 3, 1]);
  assert.equal(readU16(b, 7), 0x07);
  assert.equal(readU16(b, 9), 0x04);
  assert.equal(b[13], 2, "packet B takes the second resolution byte");
});

check("Rappy-Snappy mirrors without a resolution byte", () => {
  const [a, b] = adv.setRs(
    { row: 3, col: 1 },
    { other: { row: 3, col: 3 }, keycodes: [0x04, 0x07], delay: 20 },
  );
  assert.equal(a[4], HigherKeyMode.RS);
  assert.equal(readU16(a, 11), 20);
  assert.equal(readU16(b, 7), 0x07);
});

console.log("macros");

check("action word packs status, delay and keycode", () => {
  const action: mac.MacroAction = { down: true, delay: 32767, keycode: 0xf101 };
  const word = mac.packAction(action);
  // The sign bit must survive as an unsigned value.
  assert.ok(word > 0, "packed word must be unsigned");
  assert.deepEqual(mac.unpackAction(word), action);
});

check("key-up actions clear the status bit", () => {
  const action: mac.MacroAction = { down: false, delay: 5, keycode: 44 };
  assert.deepEqual(mac.unpackAction(mac.packAction(action)), action);
});

check("delay above 15 bits is rejected", () => {
  assert.throws(() => mac.packAction({ down: true, delay: 32768, keycode: 4 }));
});

check("macro data round-trips through a page", () => {
  const actions: mac.MacroAction[] = [
    { down: true, delay: 0, keycode: 4 },
    { down: false, delay: 12, keycode: 4 },
    { down: true, delay: 100, keycode: 5 },
  ];
  const packet = mac.setMacroData(2, 0, actions);
  const parsed = mac.parseMacroData(packet);
  assert.equal(parsed.macroId, 2);
  assert.equal(parsed.page, 0);
  assert.deepEqual(parsed.actions.slice(0, 3), actions);
});

check("actions split into 15-per-page blocks", () => {
  const actions = Array.from({ length: 31 }, () => ({
    down: true,
    delay: 1,
    keycode: 4,
  }));
  const pages = mac.pageActions(actions);
  assert.deepEqual(pages.map((p) => p.length), [15, 15, 1]);
});

console.log("keycodes");

check("combo keycodes decode to modifiers plus a base key", () => {
  // PROTOCOL.md section 5 worked examples.
  assert.deepEqual(decodeCombo(0x1329), { modifiers: 3, base: 0x29 });
  assert.deepEqual(decodeCombo(0x1808), { modifiers: 8, base: 0x08 });
  assert.equal(describeKey(0x1808), "Win+E");
  assert.equal(describeKey(0x1329), "Ctrl+Shift+Esc");
});

check("macro keycodes sit at 0xF500 + id", () => {
  assert.equal(macroKeycode(0), 0xf500);
  assert.equal(macroKeycode(15), 0xf50f);
});

check("catalogued keycodes resolve to labels", () => {
  assert.equal(describeKey(44), "Space");
  assert.equal(describeKey(0xf101), "Switch Fn1 layer");
  assert.equal(describeKey(0), "Empty Key");
});

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
