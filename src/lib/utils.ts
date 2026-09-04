import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Travel is micrometres on the wire and millimetres to a person. */
export const mm = (um: number, digits = 2): string =>
  (um / 1000).toFixed(digits);

/**
 * Travel in millimetres with trailing zeros trimmed — 2, 0.3, 0.271.
 *
 * A setting is a number the user chose, not a measurement, so padding it to a
 * fixed width claims a precision the choice did not have. This is how the
 * official driver prints them, and matching it means a value read there and a
 * value read here are the same string.
 */
export const mmTrim = (um: number): string =>
  String(Number((um / 1000).toFixed(3)));

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));
