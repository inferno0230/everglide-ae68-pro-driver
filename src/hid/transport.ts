/**
 * WebHID transport for the Sparklink-PlayJoy vendor collection.
 *
 * The protocol has no checksum, no sequence number and no authentication, so
 * the only thing keeping a reply attached to its request is that we never have
 * two commands in flight. See .codex/reverse/PROTOCOL.md section 1:
 *
 *   1. serialise all I/O through a single lock
 *   2. register the waiter before sending
 *   3. match on an N-byte prefix (2 normally, 3-4 for paged/kind-tagged reads)
 *   4. keep unmatched reports briefly so a fast reply is not lost
 */

import { REPORT_SIZE, type Report } from "./codec";

/** The vendor collection. Match on this, never on VID/PID. */
export const HID_FILTERS: HIDDeviceFilter[] = [
  { usagePage: 0xffb0, usage: 1 },
  { usagePage: 0xff80, usage: 1 },
];

export class HidError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "HidError";
  }
}

export class TimeoutError extends HidError {
  constructor(prefix: readonly number[], ms: number) {
    super(
      `no reply to [${prefix.map((b) => b.toString(16)).join(" ")}] in ${ms}ms`,
    );
    this.name = "TimeoutError";
  }
}

interface Waiter {
  prefix: readonly number[];
  resolve: (report: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SendOptions {
  /** How many leading bytes must match for a reply to count. Default 2. */
  matchBytes?: number;
  /** Per-attempt timeout in ms. Default 1000; use 3000 for save/calibrate. */
  timeout?: number;
  /** Attempts before giving up. Default 3. */
  retries?: number;
}

export interface HidIdentity {
  vendorId: number;
  productId: number;
  productName: string;
}

const RING_SIZE = 32;

export class Transport {
  private device: HIDDevice | null = null;
  private waiters: Waiter[] = [];
  /** Reports that arrived with no waiter registered yet. */
  private ring: Uint8Array[] = [];
  /** Serialises every send so only one command is ever outstanding. */
  private chain: Promise<unknown> = Promise.resolve();
  private onInput = (event: HIDInputReportEvent) => this.handleInput(event);

  static isSupported(): boolean {
    return typeof navigator !== "undefined" && "hid" in navigator;
  }

  get isOpen(): boolean {
    return this.device?.opened ?? false;
  }

  get productName(): string {
    return this.device?.productName ?? "";
  }

  get ids(): { vendorId: number; productId: number } | null {
    return this.device
      ? { vendorId: this.device.vendorId, productId: this.device.productId }
      : null;
  }

  /** Stable fields used to recognise a board after it re-enumerates on USB. */
  get identity(): HidIdentity | null {
    const device = this.device;
    return device
      ? {
          vendorId: device.vendorId,
          productId: device.productId,
          productName: device.productName,
        }
      : null;
  }

  /** Devices already granted to this origin - no prompt, no user gesture. */
  static async granted(): Promise<HIDDevice[]> {
    if (!Transport.isSupported()) return [];
    return matching(await navigator.hid.getDevices());
  }

  /** Must be called from a user gesture; shows the Chrome picker. */
  static async request(): Promise<HIDDevice[]> {
    if (!Transport.isSupported()) {
      throw new HidError(
        "WebHID needs Chrome, Edge or another Chromium browser",
      );
    }
    return matching(await navigator.hid.requestDevice({ filters: HID_FILTERS }));
  }

  /**
   * Wait for one physical USB cycle of a known board.
   *
   * Some settings, including report rate, make the AE68 Pro restart. Register
   * this before sending the command so a fast disconnect cannot be missed.
   */
  static waitForReconnect(
    identity: HidIdentity,
    timeout = 12_000,
  ): Promise<HIDDevice> {
    if (!Transport.isSupported()) {
      return Promise.reject(new HidError("WebHID is not available"));
    }

    return new Promise<HIDDevice>((resolve, reject) => {
      let disconnected = false;

      const cleanup = () => {
        clearTimeout(timer);
        navigator.hid.removeEventListener("disconnect", onDisconnect);
        navigator.hid.removeEventListener("connect", onConnect);
      };
      const onDisconnect = (event: HIDConnectionEvent) => {
        if (sameDevice(event.device, identity)) disconnected = true;
      };
      const onConnect = (event: HIDConnectionEvent) => {
        if (!disconnected || !sameDevice(event.device, identity)) return;
        cleanup();
        resolve(event.device);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new HidError("the keyboard did not reconnect after restarting"));
      }, timeout);

      navigator.hid.addEventListener("disconnect", onDisconnect);
      navigator.hid.addEventListener("connect", onConnect);
    });
  }

  async open(device: HIDDevice): Promise<void> {
    if (this.device === device && device.opened) return;
    await this.close();
    try {
      if (!device.opened) await device.open();
    } catch (err) {
      throw new HidError(
        "could not open the keyboard - another app may already hold it",
        err,
      );
    }
    this.device = device;
    device.addEventListener("inputreport", this.onInput);
  }

  async close(): Promise<void> {
    const device = this.device;
    this.device = null;
    this.rejectAll(new HidError("device closed"));
    this.ring = [];
    if (!device) return;
    device.removeEventListener("inputreport", this.onInput);
    try {
      if (device.opened) await device.close();
    } catch {
      /* the device may already be gone; nothing useful to do */
    }
  }

  /**
   * Send a command and wait for its reply. Calls are queued, so callers can
   * fire these off freely without coordinating.
   */
  send(command: Report, options: SendOptions = {}): Promise<Uint8Array> {
    const run = () => this.sendNow(command, options);
    const queued = this.chain.then(run, run);
    // Keep the chain alive even when a command rejects.
    this.chain = queued.catch(() => undefined);
    return queued;
  }

  /** Fire-and-forget: lighting direct-drive (05 05 ...) never replies. */
  sendNoReply(command: Report): Promise<void> {
    const run = async () => {
      const device = this.requireDevice();
      await device.sendReport(0, command);
    };
    const queued = this.chain.then(run, run);
    this.chain = queued.catch(() => undefined);
    return queued;
  }

  private async sendNow(
    command: Report,
    { matchBytes = 2, timeout = 1000, retries = 3 }: SendOptions,
  ): Promise<Uint8Array> {
    const device = this.requireDevice();
    const prefix = Array.from(command.subarray(0, matchBytes));

    let lastError: Error = new TimeoutError(prefix, timeout);
    for (let attempt = 0; attempt < retries; attempt++) {
      // A stale reply from a previous attempt must not satisfy this one.
      this.dropFromRing(prefix);
      const reply = this.awaitReply(prefix, timeout);
      try {
        await device.sendReport(0, command);
      } catch (err) {
        this.cancel(prefix);
        throw new HidError(
          "sendReport failed - was the keyboard unplugged?",
          err,
        );
      }
      try {
        return await reply;
      } catch (err) {
        lastError = err as Error;
        if (!(err instanceof TimeoutError)) throw err;
      }
    }
    throw lastError;
  }

  private awaitReply(
    prefix: readonly number[],
    ms: number,
  ): Promise<Uint8Array> {
    // A matching report may already have landed.
    const buffered = this.takeFromRing(prefix);
    if (buffered) return Promise.resolve(buffered);

    return new Promise<Uint8Array>((resolve, reject) => {
      const waiter: Waiter = {
        prefix,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w !== waiter);
          reject(new TimeoutError(prefix, ms));
        }, ms),
      };
      this.waiters.push(waiter);
    });
  }

  private handleInput(event: HIDInputReportEvent): void {
    const report = new Uint8Array(
      event.data.buffer,
      event.data.byteOffset,
      event.data.byteLength,
    ).slice(0, REPORT_SIZE);

    const index = this.waiters.findIndex((w) => matchesPrefix(report, w.prefix));
    if (index === -1) {
      this.ring.push(report);
      if (this.ring.length > RING_SIZE) this.ring.shift();
      return;
    }
    const [waiter] = this.waiters.splice(index, 1);
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(report);
    }
  }

  private takeFromRing(prefix: readonly number[]): Uint8Array | undefined {
    const index = this.ring.findIndex((r) => matchesPrefix(r, prefix));
    if (index === -1) return undefined;
    return this.ring.splice(index, 1)[0];
  }

  private dropFromRing(prefix: readonly number[]): void {
    this.ring = this.ring.filter((r) => !matchesPrefix(r, prefix));
  }

  private cancel(prefix: readonly number[]): void {
    const index = this.waiters.findIndex((w) => w.prefix === prefix);
    if (index === -1) return;
    const [waiter] = this.waiters.splice(index, 1);
    if (waiter) clearTimeout(waiter.timer);
  }

  private rejectAll(err: Error): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  private requireDevice(): HIDDevice {
    if (!this.device?.opened) throw new HidError("no keyboard connected");
    return this.device;
  }
}

function matchesPrefix(report: Uint8Array, prefix: readonly number[]): boolean {
  for (let i = 0; i < prefix.length; i++) {
    if (report[i] !== prefix[i]) return false;
  }
  return true;
}

function matching(devices: HIDDevice[]): HIDDevice[] {
  return devices.filter((d) =>
    d.collections?.some((c) =>
      HID_FILTERS.some((f) => c.usagePage === f.usagePage && c.usage === f.usage),
    ),
  );
}

function sameDevice(device: HIDDevice, identity: HidIdentity): boolean {
  return (
    device.vendorId === identity.vendorId &&
    device.productId === identity.productId &&
    (!identity.productName || device.productName === identity.productName) &&
    matching([device]).length === 1
  );
}
