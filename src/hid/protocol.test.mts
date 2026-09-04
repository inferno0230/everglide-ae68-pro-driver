/**
 * Self-checks for the wire format, run with `bun run test:protocol`.
 *
 * These assert against the worked examples in .codex/reverse/PROTOCOL.md, so they
 * catch a packing regression without needing the keyboard plugged in.
 */

import { strict as assert } from "node:assert";
import { pad64, readU16, u16le, mmToUm } from "./codec";
import * as layout from "./protocol/layout";
import { decodeCombo, describe as describeKey } from "./keycodes";

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

console.log("keycodes");

check("combo keycodes decode to modifiers plus a base key", () => {
  // PROTOCOL.md section 5 worked examples.
  assert.deepEqual(decodeCombo(0x1329), { modifiers: 3, base: 0x29 });
  assert.deepEqual(decodeCombo(0x1808), { modifiers: 8, base: 0x08 });
  assert.equal(describeKey(0x1808), "Win+E");
  assert.equal(describeKey(0x1329), "Ctrl+Shift+Esc");
});

check("catalogued keycodes resolve to labels", () => {
  assert.equal(describeKey(44), "Space");
  assert.equal(describeKey(0xf101), "Switch Fn1 layer");
  assert.equal(describeKey(0), "Empty Key");
});

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
