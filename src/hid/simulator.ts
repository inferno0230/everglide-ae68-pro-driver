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

/** The per-key colour buffer's shape. See .codex/reverse/PROTOCOL.md section 8. */
const KEYS_PER_PAGE = 15;
const KEYBOARD_COLOR_PAGES = 9;
const LIGHT_BAR_LEDS = 40;
const LIGHT_BAR_COLOR_PAGES = Math.ceil(LIGHT_BAR_LEDS / KEYS_PER_PAGE);
const LED_ROW_PITCH = 21;
const LED_ROWS = 6;

/** The keyboard is a pitched matrix; the decorative bar is linear. */
const isLedSlot = (zone: number, slot: number): boolean =>
  zone === 0
    ? Math.floor(slot / LED_ROW_PITCH) < LED_ROWS &&
      slot % LED_ROW_PITCH < KEYS_PER_PAGE
    : zone === 1 && slot < LIGHT_BAR_LEDS;

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

const MAX_TRAVEL_UM = 4000;
const REST_ADC = 2340;

interface SimPerformance {
  mode: number;
  press: number;
  release: number;
  rtFirst: number;
  rtPress: number;
  rtRelease: number;
  pressDead: number;
  releaseDead: number;
  axis: number;
  calibrate: number;
  axisV2Id: number;
  axisRangeMax: number;
  axisCoefficient: number;
}

function defaultPalette() {
  return [
    { b: 0, g: 0, r: 0, h: 0 }, // slot 0 is the "cycle hues" slot
    { b: 60, g: 60, r: 247, h: 0 },
    { b: 80, g: 185, r: 63, h: 85 },
    { b: 34, g: 153, r: 210, h: 40 },
    { b: 247, g: 129, r: 47, h: 210 },
    { b: 200, g: 80, r: 200, h: 300 },
    { b: 255, g: 255, r: 255, h: 0 },
    { b: 120, g: 200, r: 255, h: 30 },
  ];
}

const defaultPerformance = (): SimPerformance => ({
  mode: 0,
  press: 1200,
  release: 1200,
  rtFirst: 300,
  rtPress: 200,
  rtRelease: 200,
  pressDead: 100,
  releaseDead: 100,
  axis: 1,
  calibrate: 1,
  axisV2Id: 1,
  axisRangeMax: MAX_TRAVEL_UM,
  axisCoefficient: 1000,
});

export class SimulatedKeyboard {
  readonly vendorId = 0x1ca6;
  readonly productId = 0x3006;
  readonly productName = "AE68 Pro (simulated)";
  readonly collections = [
    { usagePage: 0xffb0, usage: 1 },
  ] as unknown as HIDCollectionInfo[];

  opened = false;

  private listeners = new Set<Listener>();
  private performance = new Map<string, SimPerformance>();
  private keymap: number[][][] = [];
  private activeProfile = 0;
  private profileNames = ["Config 1", "Config 2", "Config 3", "Config 4"];
  private reportRateCode = 3;
  private calibrating = false;

  /**
   * Advanced keys, stored as the raw payload the write carried.
   *
   * Keeping the bytes rather than a parsed object is deliberate: the parser is
   * the thing under test, so the simulator must not get a chance to normalise
   * a field on its way back out.
   */
  private higherKeys = new Map<string, Uint8Array>();

  /**
   * Individually pinned colour, per area, indexed the way the board does: the
   * keyboard uses a 21-slot row pitch while the 40-LED bar is contiguous.
   *
   * The padding is modelled rather than smoothed over, because a driver that
   * assumes physical key order still *looks* correct against a forgiving fake
   * and paints the wrong keys on real hardware.
   */
  private keyColors: Record<number, Map<number, [number, number, number]>> = {
    0: new Map(),
    1: new Map(),
  };

  /**
   * Lighting is per area: 0 is the keyboard (dual-face, 20 effects), 1 the
   * 40-LED bar (single on/off, 5 effects).
   */
  private lighting: Record<number, {
    open: number; effect: number; brightness: number;
    speed: number; direction: number; paletteSlot: number;
  }> = {
    0: { open: 3, effect: 14, brightness: 80, speed: 60, direction: 0, paletteSlot: 0 },
    1: { open: 0, effect: 0, brightness: 100, speed: 40, direction: 0, paletteSlot: 0 },
  };
  private paletteByArea: Record<number, Array<{ b: number; g: number; r: number; h: number }>> = {
    0: defaultPalette(),
    1: defaultPalette(),
  };
  private correction = { r: 255, g: 255, b: 255 };

  constructor() {
    for (let r = 1; r < LAYOUT.length; r++) {
      const keys = LAYOUT[r] ?? [];
      const cols = electricalColumns(r, keys.length);
      for (const col of cols) this.performance.set(`${r}:${col}`, defaultPerformance());
    }
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
        return this.global(req, reply, put16);
      case Category.LayoutAndKey:
        return this.layout(req, reply, put16);
      case Category.Performance:
        return this.perf(req, reply, put16);
      case Category.Lighting:
        return this.light(req, reply);
      case Category.HigherKey:
        return this.higher(req, reply);
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

  private global(
    req: Uint8Array,
    reply: Uint8Array,
    put16: (at: number, v: number) => void,
  ): Uint8Array {
    switch (req[1]) {
      case 1: // factory reset
        for (const [key] of this.performance) {
          this.performance.set(key, defaultPerformance());
        }
        return reply;
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
      case 6:
        this.calibrating = req[2] === 0;
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
      case 14: // macro space
        reply[3] = 16;
        put16(4, 2048);
        return reply;
      default:
        return reply;
    }
  }

  /**
   * Category 6. A read answers with whatever the last write stored, and mode
   * NONE clears the entry — the same contract the board honours.
   */
  private higher(req: Uint8Array, reply: Uint8Array): Uint8Array {
    const id = `${req[2]}:${req[3]}`;
    if (req[1] === 2) {
      if ((req[4] ?? 0) === 0) this.higherKeys.delete(id);
      else this.higherKeys.set(id, req.slice(4, 24));
      reply.set(req.subarray(0, 24));
      return reply;
    }
    const stored = this.higherKeys.get(id);
    if (stored) reply.set(stored, 4);
    return reply;
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
      case 3: {
        // GetKeyCode
        const [, , layer = 0, r = 0, col = 0] = req;
        reply.set([layer, r, col], 2);
        put16(5, this.keymap[layer]?.[r]?.[col] ?? 0);
        return reply;
      }
      case 4: {
        // SetKeyCode
        const [, , layer = 0, r = 0, col = 0] = req;
        const kc = (req[5] ?? 0) | ((req[6] ?? 0) << 8);
        const rowArr = this.keymap[layer]?.[r];
        if (rowArr) rowArr[col] = kc;
        return reply;
      }
      default:
        return reply;
    }
  }

  private perf(
    req: Uint8Array,
    reply: Uint8Array,
    put16: (at: number, v: number) => void,
  ): Uint8Array {
    const write = (p: SimPerformance) => {
      reply[4] = p.mode;
      put16(5, p.press);
      put16(7, p.release);
      put16(9, p.rtFirst);
      put16(11, p.rtPress);
      put16(13, p.rtRelease);
      put16(15, p.pressDead);
      put16(17, p.releaseDead);
      reply[19] = p.axis;
      reply[20] = p.calibrate;
      put16(21, p.axisV2Id);
      put16(23, p.axisRangeMax);
      put16(25, p.axisCoefficient);
    };

    switch (req[1]) {
      case 1: {
        const key = `${req[2]}:${req[3]}`;
        write(this.performance.get(key) ?? defaultPerformance());
        return reply;
      }
      case 2: {
        const key = `${req[2]}:${req[3]}`;
        const u16 = (at: number) => (req[at] ?? 0) | ((req[at + 1] ?? 0) << 8);
        const next: SimPerformance = {
          mode: req[4] ?? 0,
          press: u16(5),
          release: u16(7),
          rtFirst: u16(9),
          rtPress: u16(11),
          rtRelease: u16(13),
          pressDead: u16(15),
          releaseDead: u16(17),
          axis: req[19] ?? 1,
          calibrate: req[20] ?? 1,
          axisV2Id: u16(21),
          axisRangeMax: u16(23),
          axisCoefficient: u16(25),
        };
        // The documented clamp: fixed mode collapses the reset point onto the
        // actuation point. Writing this here is what makes the UI's
        // reconcile-from-the-reply path testable without hardware.
        if (next.mode === 0) next.release = next.press;
        this.performance.set(key, next);
        write(next);
        return reply;
      }
      case 3: {
        // AxisData. No keys are physically pressed in a simulation, so this
        // reports rest values with a little sensor noise, never fake presses.
        const kind = req[2] ?? 0;
        const r = req[3] ?? 0;
        const cols = electricalColumns(r, rowOf(r).length);
        for (const col of cols) {
          const noise = Math.round((Math.random() - 0.5) * 6);
          const value =
            kind === 0 ? REST_ADC + noise : kind === 2 ? MAX_TRAVEL_UM : 0;
          put16(4 + col * 2, Math.max(0, value));
        }
        return reply;
      }
      default:
        return reply;
    }
  }

  private light(req: Uint8Array, reply: Uint8Array): Uint8Array | null {
    const rw = req[1];
    const config = req[3];

    if (rw === 5) return null; // direct drive is fire-and-forget
    if (rw === 6) return reply;

    if (rw === 3 || rw === 4) {
      const zone = req[2] ?? 0;
      const page = req[3] ?? 0;
      const pages = zone === 0 ? KEYBOARD_COLOR_PAGES : LIGHT_BAR_COLOR_PAGES;
      if (page >= pages) return null;
      const held = this.keyColors[zone] ?? this.keyColors[0]!;

      for (let i = 0; i < KEYS_PER_PAGE; i++) {
        const slot = page * KEYS_PER_PAGE + i;
        const at = 4 + i * 4;
        if (rw === 4) {
          // A write only lands on a slot the hardware actually drives.
          if (isLedSlot(zone, slot)) {
            if (req[at + 3] === 0xff) {
              held.set(slot, [req[at] ?? 0, req[at + 1] ?? 0, req[at + 2] ?? 0]);
            } else {
              held.delete(slot);
            }
          }
          reply.set(req.subarray(at, at + 4), at);
        } else {
          const c = held.get(slot);
          if (c) reply.set([c[0], c[1], c[2], 0xff], at);
        }
      }
      return reply;
    }

    const area = req[2] ?? 0;
    const state = this.lighting[area] ?? this.lighting[0]!;
    const pal = this.paletteByArea[area] ?? this.paletteByArea[0]!;

    if (rw === 1) {
      if (config === 0) {
        const l = state;
        reply.set(
          [l.open, l.effect, l.brightness, l.speed, l.direction, l.paletteSlot],
          4,
        );
      } else if (config === 1) {
        pal.forEach((s, i) => reply.set([s.b, s.g, s.r, s.h], 4 + i * 4));
      } else if (config === 2) {
        const c = this.correction;
        reply.set([c.r, c.g, c.b], 4);
      }
      return reply;
    }

    if (rw === 2) {
      if (config === 0) {
        this.lighting[area] = {
          open: req[4] ?? 0,
          effect: req[5] ?? 0,
          brightness: req[6] ?? 0,
          speed: req[7] ?? 0,
          direction: req[8] ?? 0,
          paletteSlot: req[9] ?? 0,
        };
        const l = this.lighting[area]!;
        reply.set(
          [l.open, l.effect, l.brightness, l.speed, l.direction, l.paletteSlot],
          4,
        );
      } else if (config === 1) {
        this.paletteByArea[area] = pal.map((_, i) => ({
          b: req[4 + i * 4] ?? 0,
          g: req[5 + i * 4] ?? 0,
          r: req[6 + i * 4] ?? 0,
          h: req[7 + i * 4] ?? 0,
        }));
      } else if (config === 2) {
        this.correction = {
          r: req[4] ?? 0,
          g: req[5] ?? 0,
          b: req[6] ?? 0,
        };
      }
      return reply;
    }
    return reply;
  }

  get isCalibrating(): boolean {
    return this.calibrating;
  }
}

/** The simulated board, typed as the HIDDevice the Transport expects. */
export const createSimulatedDevice = (): HIDDevice =>
  new SimulatedKeyboard() as unknown as HIDDevice;
