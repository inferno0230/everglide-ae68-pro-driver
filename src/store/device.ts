import { create } from "zustand";
import { Transport, HidError } from "@/hid/transport";
import { Keyboard, type DeviceSnapshot } from "@/hid/keyboard";
import { createSimulatedDevice } from "@/hid/simulator";

export type Status =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected"
  | "error";

export const keyId = (row: number, col: number) => `${row}:${col}`;

interface DeviceState {
  status: Status;
  error: string | null;
  simulated: boolean;

  snapshot: DeviceSnapshot | null;

  init: () => Promise<void>;
  connect: () => Promise<void>;
  connectSimulated: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const transport = new Transport();
const keyboard = new Keyboard(transport);

/** The driver, for callers that need it directly (the live travel test). */
export const device = keyboard;

const message = (err: unknown): string =>
  err instanceof HidError || err instanceof Error
    ? err.message
    : "the keyboard stopped responding";

export const useDevice = create<DeviceState>((set) => ({
  status: "disconnected",
  error: null,
  simulated: false,
  snapshot: null,

  async init() {
    if (!Transport.isSupported()) {
      set({ status: "unsupported" });
      return;
    }
    // A board already granted to this origin reconnects with no prompt and no
    // user gesture, so the app can come up connected.
    const granted = await Transport.granted();
    const first = granted[0];
    if (first) await open(first, false);
  },

  async connect() {
    if (!Transport.isSupported()) {
      set({ status: "unsupported" });
      return;
    }
    try {
      const [chosen] = await Transport.request();
      if (!chosen) return; // the user dismissed the picker
      await open(chosen, false);
    } catch (err) {
      set({ status: "error", error: message(err) });
    }
  },

  async connectSimulated() {
    await open(createSimulatedDevice(), true);
  },

  async disconnect() {
    await transport.close();
    set({
      status: "disconnected",
      snapshot: null,
      simulated: false,
      error: null,
    });
  },
}));

// --- helpers ---------------------------------------------------------------

async function open(hid: HIDDevice, simulated: boolean): Promise<void> {
  const set = useDevice.setState;
  set({ status: "connecting", error: null, simulated });
  try {
    await transport.open(hid);
    await reload();
    set({ status: "connected" });
  } catch (err) {
    set({ status: "error", error: message(err) });
  }
}

/** Read the whole per-profile picture from the board. */
async function reload(): Promise<void> {
  const set = useDevice.setState;
  const snapshot = await keyboard.describe();

  set({
    snapshot,
  });
}

/**
 * Dev-only handle for driving the protocol by hand from the console.
 *
 * Verifying an undocumented command means seeing the raw 64-byte reply, not a
 * parsed object, so this exposes the transport as well as the facade. Stripped
 * from production builds by the `import.meta.env.DEV` guard.
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ae68 = {
    transport,
    keyboard,
    useDevice,
  };
}
