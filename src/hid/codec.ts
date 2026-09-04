/**
 * Byte-level helpers for the Sparklink-PlayJoy 64-byte report format.
 * See .codex/reverse/PROTOCOL.md §1 — everything is little-endian, travel is µm.
 */

/** Report payload: always exactly 64 bytes, report id 0. */
export const REPORT_SIZE = 64;

/**
 * A fully-formed output report. The explicit ArrayBuffer parameter matters:
 * sendReport takes BufferSource, which excludes SharedArrayBuffer-backed views.
 */
export type Report = Uint8Array<ArrayBuffer>;

/** Zero-pad a command to a full 64-byte report. */
export function pad64(bytes: readonly number[]): Report {
  if (bytes.length > REPORT_SIZE) {
    throw new RangeError(`command is ${bytes.length} bytes, max ${REPORT_SIZE}`);
  }
  const out = new Uint8Array(REPORT_SIZE);
  out.set(bytes);
  return out;
}

/** Split a u16 into [lo, hi] — the wire order for every multi-byte field. */
export function u16le(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/** Join [lo, hi] back into a u16. */
export function readU16(buf: Uint8Array, offset: number): number {
  return (buf[offset] ?? 0) | ((buf[offset + 1] ?? 0) << 8);
}

/** Split a u32 into 4 little-endian bytes. */
export function u32le(value: number): [number, number, number, number] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ];
}

export function readU32(buf: Uint8Array, offset: number): number {
  return (
    ((buf[offset] ?? 0) |
      ((buf[offset + 1] ?? 0) << 8) |
      ((buf[offset + 2] ?? 0) << 16) |
      ((buf[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

/** boardId is the one big-endian field in the protocol (§4). */
export function readU32be(buf: Uint8Array, offset: number): number {
  return (
    (((buf[offset] ?? 0) << 24) |
      ((buf[offset + 1] ?? 0) << 16) |
      ((buf[offset + 2] ?? 0) << 8) |
      (buf[offset + 3] ?? 0)) >>>
    0
  );
}

/** Read a NUL-trimmed UTF-8 string out of a report slice. */
export function readString(buf: Uint8Array, start: number, end: number): string {
  const slice = buf.subarray(start, end);
  const nul = slice.indexOf(0);
  return new TextDecoder().decode(nul === -1 ? slice : slice.subarray(0, nul));
}

/** Travel on the wire is micrometres; the UI works in millimetres. */
export const mmToUm = (mm: number): number => Math.round(mm * 1000);
export const umToMm = (um: number): number => um / 1000;

/** Read `[4:]` as a u16 array — the shape of every per-column reply. */
export function readU16Array(buf: Uint8Array, start = 4): number[] {
  const out: number[] = [];
  for (let i = start; i + 1 < buf.length; i += 2) out.push(readU16(buf, i));
  return out;
}

export const hex = (n: number, width = 2): string =>
  `0x${n.toString(16).toUpperCase().padStart(width, "0")}`;
