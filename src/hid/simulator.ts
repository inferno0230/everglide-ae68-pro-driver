/**
 * A simulated AE68 Pro.
 *
 * This is a fake `HIDDevice`, not a fake driver — it plugs in underneath the
 * real Transport, so demo mode exercises the actual framing, the actual
 * serialisation, and the actual parsers. A bug in the protocol layer shows up
 * here rather than hiding behind a mocked facade.
 *
 * Its responses follow .codex/reverse/PROTOCOL.md. Where the real firmware's exact
 * behaviour is unknown, the simulator does the documented thing and nothing
 * more; it is a development aid, never evidence about the hardware.
 */

import { REPORT_SIZE } from "./codec";
import { Category } from "./protocol/constants";

type Listener = (event: HIDInputReportEvent) => void;

/** Physical layout of the AE68 Pro, row by row: [label keycode, x, width]. */
interface SimKey {
  keycode: number;
  x: number;
  width: number;
}

const K = {
  esc: 41, one: 30, two: 31, three: 32, four: 33, five: 34, six: 35, seven: 36,
  eight: 37, nine: 38, zero: 39, minus: 45, equal: 46, bksp: 42, grave: 53,
  tab: 43, q: 20, w: 26, e: 8, r: 21, t: 23, y: 28, u: 24, i: 12, o: 18, p: 19,
  lbr: 47, rbr: 48, bslash: 49, del: 76,
  caps: 57, a: 4, s: 22, d: 7, f: 9, g: 10, h: 11, j: 13, k: 14, l: 15,
  semi: 51, quote: 52, enter: 40, pgup: 75,
  lshift: 225, z: 29, x: 27, c: 6, v: 25, b: 5, n: 17, m: 16,
  comma: 54, dot: 55, slash: 56, rshift: 229, up: 82, pgdn: 78,
  lctrl: 224, lgui: 227, lalt: 226, space: 44, ralt: 230, fn: 0xf101,
  rctrl: 228, left: 80, down: 81, right: 79,
} as const;

/**
 * Rows 1-5 with 15, 15, 14, 14, 10 keys. Widths are the real 65% widths; the
 * simulator emits `ratio` as `round(width * 4)` clamped into the 4-bit field,
 * which is what makes the renderer derive width from x-gaps instead.
 */
const LAYOUT: SimKey[][] = [
  [], // row 0 is unused on this board
  row([
    [K.esc, 1], [K.one, 1], [K.two, 1], [K.three, 1], [K.four, 1], [K.five, 1],
    [K.six, 1], [K.seven, 1], [K.eight, 1], [K.nine, 1], [K.zero, 1],
    [K.minus, 1], [K.equal, 1], [K.bksp, 2], [K.grave, 1],
  ]),
  row([
    [K.tab, 1.5], [K.q, 1], [K.w, 1], [K.e, 1], [K.r, 1], [K.t, 1], [K.y, 1],
    [K.u, 1], [K.i, 1], [K.o, 1], [K.p, 1], [K.lbr, 1], [K.rbr, 1],
    [K.bslash, 1.5], [K.del, 1],
  ]),
  row([
    [K.caps, 1.75], [K.a, 1], [K.s, 1], [K.d, 1], [K.f, 1], [K.g, 1], [K.h, 1],
    [K.j, 1], [K.k, 1], [K.l, 1], [K.semi, 1], [K.quote, 1], [K.enter, 2.25],
    [K.pgup, 1],
  ]),
  row([
    [K.lshift, 2.25], [K.z, 1], [K.x, 1], [K.c, 1], [K.v, 1], [K.b, 1],
    [K.n, 1], [K.m, 1], [K.comma, 1], [K.dot, 1], [K.slash, 1], [K.rshift, 1.75],
    [K.up, 1], [K.pgdn, 1],
  ]),
  row([
    [K.lctrl, 1.25], [K.lgui, 1.25], [K.lalt, 1.25], [K.space, 6.25],
    [K.ralt, 1], [K.fn, 1], [K.rctrl, 1], [K.left, 1], [K.down, 1], [K.right, 1],
  ]),
];

const rowOf = (n: number | undefined): SimKey[] => LAYOUT[n ?? 0] ?? [];

function row(spec: ReadonlyArray<readonly [number, number]>): SimKey[] {
  let x = 0;
  return spec.map(([keycode, width]) => {
    const key = { keycode, x, width };
    x += width;
    return key;
  });
}

/** Electrical columns, mirroring the sparse mapping the real board reports. */
function electricalColumns(rowIndex: number, count: number): number[] {
  // The bottom row's gaps are the documented case (PROTOCOL.md section 5).
  if (rowIndex === 5) return [0, 1, 2, 6, 9, 10, 11, 12, 13, 14];
  return Array.from({ length: count }, (_, i) => i);
}

export class SimulatedKeyboard {
  readonly vendorId = 0x1ca6;
  readonly productId = 0x3006;
  readonly productName = "AE68 Pro (simulated)";
  readonly collections = [
    { usagePage: 0xffb0, usage: 1 },
  ] as unknown as HIDCollectionInfo[];

  opened = false;

  private listeners = new Set<Listener>();
  private keymap: number[][][] = [];
  private activeProfile = 0;
  private profileNames = ["Config 1", "Config 2", "Config 3", "Config 4"];
  private reportRateCode = 3;

  constructor() {
    this.keymap = this.buildKeymap();
  }

  private buildKeymap(): number[][][] {
    // Layer 0 is the physical legend; Fn1 carries a small, plausible set.
    const layers: number[][][] = [];
    for (let layer = 0; layer < 4; layer++) {
      const rows: number[][] = [];
      for (let r = 0; r < LAYOUT.length; r++) {
        const keys = LAYOUT[r] ?? [];
        const cols = electricalColumns(r, keys.length);
        const arr = new Array<number>(15).fill(0);
        keys.forEach((key, i) => {
          const col = cols[i];
          if (col === undefined) return;
          // Non-main layers are transparent except where Fn1 adds media keys.
          arr[col] = layer === 0 ? key.keycode : 1;
        });
        rows.push(arr);
      }
      layers.push(rows);
    }
    const fn1 = layers[1];
    if (fn1) {
      // Fn1: F-row on the number row, media on the right cluster.
      const top = fn1[1];
      if (top) for (let i = 1; i <= 12; i++) top[i] = 57 + i; // F1-F12
      const bottom = fn1[3];
      if (bottom) {
        bottom[9] = 0x20e9; // Volume Up
        bottom[10] = 0x20ea; // Volume Down
        bottom[11] = 0x20cd; // Play/Pause
      }
    }
    return layers;
  }

  // --- HIDDevice surface ---------------------------------------------------

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
    this.listeners.clear();
  }

  addEventListener(_type: "inputreport", listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "inputreport", listener: Listener): void {
    this.listeners.delete(listener);
  }

  async sendReport(_reportId: number, data: BufferSource): Promise<void> {
    const req = new Uint8Array(
      data instanceof ArrayBuffer ? data : data.buffer,
      data instanceof ArrayBuffer ? 0 : data.byteOffset,
      data.byteLength,
    );
    const reply = this.respond(req);
    if (!reply) return; // fire-and-forget commands get no answer
    // Answer asynchronously, the way real HID does.
    queueMicrotask(() => this.emit(reply));
  }

  private emit(report: Uint8Array): void {
    const view = new DataView(
      report.buffer,
      report.byteOffset,
      report.byteLength,
    );
    const event = { data: view, reportId: 0 } as HIDInputReportEvent;
    for (const listener of this.listeners) listener(event);
  }

  // --- protocol ------------------------------------------------------------

  private respond(req: Uint8Array): Uint8Array | null {
    const reply = new Uint8Array(REPORT_SIZE);
    reply.set(req.subarray(0, 4));
    const put16 = (at: number, v: number) => {
      reply[at] = v & 0xff;
      reply[at + 1] = (v >> 8) & 0xff;
    };

    switch (req[0]) {
      case Category.Device:
        return this.device(req, reply);
      case Category.Global:
        return this.global(req, reply);
      case Category.LayoutAndKey:
        return this.layout(req, reply, put16);
      default:
        return reply;
    }
  }

  private device(req: Uint8Array, reply: Uint8Array): Uint8Array {
    switch (req[1]) {
      case 1: // protocol version
        reply.set([1, 2, 1, 0], 2);
        return reply;
      case 2: {
        // DeviceInfo
        reply[2] = 1; // keyboard
        reply[3] = 0;
        reply.set([0x00, 0x01, 0x30, 0x06], 4); // boardId, big-endian
        reply.set([0, 1, 4, 0], 8); // app 0.1.4.0
        reply.set([1, 1, 0, 0], 12); // pcb 1-1-0-0
        reply[16] = 1;
        // Serial is a 6-char ASCII prefix plus a 6-byte binary id, which is
        // the shape a real board returns.
        reply.set(new TextEncoder().encode("SIM001"), 17);
        reply.set([0x1f, 0x93, 0x01, 0x99, 0xa8, 0x00], 23);
        reply.set(new TextEncoder().encode("2026090111:40:23"), 29);
        return reply;
      }
      case 3: // features: magnetic axis, USB, RGB
        reply.set([2, 1, 1, 0], 2);
        return reply;
      default:
        return reply;
    }
  }

  private global(req: Uint8Array, reply: Uint8Array): Uint8Array {
    switch (req[1]) {
      case 2: // save
        return reply;
      case 3:
        switch (req[2]) {
          case 1:
            reply[3] = this.activeProfile;
            return reply;
          case 2:
            this.activeProfile = req[3] ?? 0;
            return reply;
          case 3: {
            const idx = req[3] ?? 0;
            reply[3] = idx;
            reply.set(
              new TextEncoder().encode(this.profileNames[idx] ?? ""),
              4,
            );
            return reply;
          }
          case 4: {
            const idx = req[3] ?? 0;
            const raw = req.subarray(4, 36);
            const nul = raw.indexOf(0);
            this.profileNames[idx] = new TextDecoder().decode(
              nul === -1 ? raw : raw.subarray(0, nul),
            );
            return reply;
          }
          default:
            return reply;
        }
      case 5:
        if (req[2] === 1) reply[3] = this.reportRateCode;
        else this.reportRateCode = req[3] ?? 3;
        return reply;
      case 8:
        // Two zones. The second byte is the zone's effect count, not its LED
        // count: 20 effects on the keyboard matrix, 5 on the 40-LED bar.
        reply[3] = 2;
        reply.set([0, 20, 6, 15], 4);
        reply.set([1, 5, 1, 40], 8);
        return reply;
      case 10: // dual lighting
        reply[3] = 1;
        return reply;
      case 11:
        reply[3] = 1;
        return reply;
      case 12: // rapid-trigger precision, 0.01mm
        reply[3] = 10;
        return reply;
      default:
        return reply;
    }
  }

  private layout(
    req: Uint8Array,
    reply: Uint8Array,
    put16: (at: number, v: number) => void,
  ): Uint8Array {
    switch (req[1]) {
      case 5: {
        // GetKeyLayoutStyle — pack the physical row.
        const r = req[2] ?? 0;
        const keys = rowOf(r);
        if (keys.length === 0) {
          reply[2] = 0xff;
          return reply;
        }
        reply[2] = r;
        keys.forEach((key, i) => {
          const s = r << 2;
          const l = Math.round(key.x * 4) & 0x7f;
          const ratio = Math.min(11, Math.round(key.width * 4)) & 0x0f;
          put16(3 + i * 2, (s << 11) | (l << 4) | ratio);
        });
        return reply;
      }
      case 1: {
        // GetKeyLayout
        const layer = req[2] ?? 0;
        const r = req[3] ?? 0;
        reply[2] = layer;
        reply[3] = r;
        const arr = this.keymap[layer]?.[r] ?? [];
        arr.forEach((kc, i) => put16(4 + i * 2, kc));
        return reply;
      }
      default:
        return reply;
    }
  }

}

/** The simulated board, typed as the HIDDevice the Transport expects. */
export const createSimulatedDevice = (): HIDDevice =>
  new SimulatedKeyboard() as unknown as HIDDevice;
