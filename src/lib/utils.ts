import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Travel is micrometres on the wire and millimetres to a person. */
export const mm = (um: number, digits = 2): string =>
  (um / 1000).toFixed(digits);

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));
