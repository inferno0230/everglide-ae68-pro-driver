import * as React from "react";
import { useDevice } from "@/store/device";
import { KeyboardView } from "@/components/KeyboardView";
import { LightBar } from "@/components/LightBar";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Panel,
  PanelHeader,
  Readout,
  Settle,
  Segmented,
  Select,
  Slider,
  Switch,
  useSliderDraft,
} from "@/components/ui";
import {
  EFFECTS,
  effectLabel,
  faceIsOn,
  isDualFaceArea,
  LightArea,
  LightFace,
  SPEED_MAX,
  withFace,
} from "@/hid/protocol/constants";
import { RGB_SLOT, type PaletteSlot, type Rgb } from "@/hid/protocol/lighting";
import { capLabel } from "@/hid/keycodes";
import { cn } from "@/lib/utils";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const EMPTY_COLORS: ReadonlyMap<string, Rgb> = new Map();

const lightBarId = (index: number): string => `0:${index}`;

export function LightingSection() {
  const {
    snapshot,
    lighting,
    palette,
    writeLighting,
    writePalette,
    paintLights,
    lightColors,
    keymap,
    revision,
    busy,
  } = useDevice();

  const [area, setArea] = React.useState<number>(LightArea.Keyboard);
  const [showAddressable, setShowAddressable] = React.useState(false);
  const [brush, setBrush] = React.useState<Rgb>({ r: 255, g: 255, b: 255 });

  /**
   * Keys covered by the stroke in progress.
   *
   * A paint is a whole-buffer write — nine packets — so doing one per key would
   * put 135 packets on the wire for a drag across a row. The stroke shows
   * instantly from here and reaches the board once, on release, the same way a
   * travel slider commits.
   */
  const stroke = React.useRef(new Set<string>());
  const [strokeVersion, setStrokeVersion] = React.useState(0);

  const paint = (id: string) => {
    if (stroke.current.has(id)) return;
    stroke.current.add(id);
    setStrokeVersion((v) => v + 1);
  };

  const commitStroke = () => {
    const ids = [...stroke.current];
    stroke.current.clear();
    setStrokeVersion((v) => v + 1);
    if (ids.length > 0) void paintLights(area, ids, brush);
  };

  React.useEffect(() => {
    stroke.current.clear();
    setStrokeVersion((v) => v + 1);
  }, [area]);

  if (!snapshot) return null;

  const zones = snapshot.ledZones;
  const zone = zones.find((z) => z.index === area) ?? zones[0];
  const base = lighting[area];
  const slots = palette[area] ?? [];
  const areaColors = lightColors[area] ?? EMPTY_COLORS;
  if (!zone || !base) return null;

  const isKeyboard = area === LightArea.Keyboard;
  const dualFace = isDualFaceArea(area, snapshot.dualLighting);

  // Each zone advertises how many effects it supports: 20 for the keyboard,
  // 5 for the light bar. Offering all twenty on the bar would be a lie.
  const effects = EFFECTS.slice(0, zone.effectCount || EFFECTS.length);
  const effect = effects.find((e) => e.id === base.effect);
  const isStatic = base.effect === 0;
  const cyclesHue = base.paletteSlot === RGB_SLOT;
  const animates = !isStatic || cyclesHue;
  const lit = base.open !== 0;

  const set = (patch: Parameters<typeof writeLighting>[1]) =>
    void writeLighting(area, patch);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader>
          <span>Preview</span>
          <div className="flex items-center gap-2">
            {zones.length > 1 ? (
              <Segmented
                size="sm"
                value={area}
                onChange={setArea}
                options={zones.map((z) => ({
                  value: z.index,
                  label:
                    z.index === LightArea.Keyboard ? "Keyboard" : "Light bar",
                }))}
              />
            ) : null}
            <label className="flex cursor-pointer items-center gap-2 text-2xs text-fg-muted">
              <Switch
                checked={showAddressable}
                onCheckedChange={setShowAddressable}
                aria-label={`Show ${isKeyboard ? "per-key" : "per-LED"} colour editor`}
                aria-controls="addressable-lighting-editor"
              />
              <span>{isKeyboard ? "Per-key colour" : "Per-LED colour"}</span>
              {areaColors.size > 0 ? (
                <Badge tone="accent">{areaColors.size} painted</Badge>
              ) : null}
            </label>
            <Badge>{zone.effectCount} effects</Badge>
          </div>
        </PanelHeader>

        {showAddressable ? (
          <div id="addressable-lighting-editor">
            <div className="overflow-x-auto p-4">
              {isKeyboard ? (
                <KeyboardView
                  keys={snapshot.keys}
                  selection={EMPTY_SELECTION}
                  onPaint={paint}
                  onPaintEnd={commitStroke}
                  onClear={(id) => void paintLights(area, [id], null)}
                  label={(key) =>
                    capLabel(keymap[0]?.[key.row]?.[key.col] ?? 0)
                  }
                  state={(key) => {
                    // A pinned key shows the colour the board is actually holding,
                    // not the effect it is overriding. Keys under the stroke in
                    // progress show the brush before the board has been told.
                    void strokeVersion;
                    const pinned = stroke.current.has(key.id)
                      ? brush
                      : areaColors.get(key.id);
                    if (pinned) {
                      return {
                        fill: rgbCss(pinned),
                        foreground: contrastText(pinned),
                        mark: "custom" as const,
                      };
                    }
                    // The firmware renders effects dynamically, and a static cap
                    // colour suggests a precision the preview cannot provide.
                    // Leave unpinned keys neutral and show only stored overrides.
                    return undefined;
                  }}
                  ariaLabel="Keyboard lighting — click or drag to paint a key"
                />
              ) : (
                <LightBar
                  count={zone.cols}
                  onPaint={(i) => paint(lightBarId(i))}
                  onPaintEnd={commitStroke}
                  onClear={(i) => void paintLights(area, [lightBarId(i)], null)}
                  custom={(i) => {
                    void strokeVersion;
                    const id = lightBarId(i);
                    return stroke.current.has(id) || areaColors.has(id);
                  }}
                  color={(i) => {
                    void strokeVersion;
                    const id = lightBarId(i);
                    const pinned = stroke.current.has(id)
                      ? brush
                      : areaColors.get(id);
                    if (pinned) return rgbCss(pinned);
                    return null;
                  }}
                />
              )}
            </div>

            <p className="border-t border-line px-3 py-2 text-2xs text-fg-muted">
              {isKeyboard
                ? "Drag to paint keys, right-click to hand one back. Only stored per-key colours are shown; unpainted keys remain neutral and follow the board's effect."
                : `Drag to paint the ${zone.cols}-LED bar, right-click to hand one LED back. Only stored per-LED colours are shown; unpainted LEDs remain neutral and follow the bar's effect.`}
            </p>
          </div>
        ) : null}
      </Panel>

      {showAddressable ? (
        <Panel>
          <PanelHeader>
            <span className="flex items-center gap-2">
              {isKeyboard ? "Per-key colour" : "Per-LED colour"}
              {areaColors.size > 0 ? (
                <Badge tone="accent">{areaColors.size} painted</Badge>
              ) : null}
            </span>
            <ConfirmDialog
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || areaColors.size === 0}
                >
                  Clear all
                </Button>
              }
              title={`Clear all ${isKeyboard ? "key" : "light-bar"} colours?`}
              description="Every custom colour in this lighting area will be handed back to the active effect."
              confirmLabel="Clear all colours"
              onConfirm={() =>
                void paintLights(area, [...areaColors.keys()], null)
              }
            />
          </PanelHeader>

          <div className="flex flex-wrap items-center gap-4 p-4">
            <Field
              label="Brush"
              className="shrink-0"
              control={
                <div className="flex items-center gap-2">
                  <label
                    className="block h-8 w-14 shrink-0 cursor-pointer rounded-md ring-1 ring-inset ring-line transition-shadow hover:ring-line-strong"
                    style={{
                      backgroundColor: `rgb(${brush.r} ${brush.g} ${brush.b})`,
                    }}
                  >
                    <span className="sr-only">Brush colour</span>
                    <input
                      type="color"
                      className="h-0 w-0 opacity-0"
                      value={toHex(brush)}
                      onChange={(e) => setBrush(fromHex(e.target.value))}
                    />
                  </label>
                  <Readout
                    value={toHex(brush).toUpperCase()}
                    size="sm"
                    tone="muted"
                  />
                </div>
              }
            />

            <Field
              label="From the palette"
              className="min-w-0 flex-1"
              hint="The eight slots this area already stores. Slot 1 cycles, so it has no single colour to paint with."
              control={
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((slot, i) =>
                    i === RGB_SLOT ? null : (
                      <button
                        key={i}
                        type="button"
                        aria-label={`Use palette slot ${i + 1}`}
                        onClick={() =>
                          setBrush({ r: slot.r, g: slot.g, b: slot.b })
                        }
                        className="h-8 w-8 rounded-md ring-1 ring-inset ring-line transition-shadow hover:ring-line-strong"
                        style={{
                          backgroundColor: `rgb(${slot.r} ${slot.g} ${slot.b})`,
                        }}
                      />
                    ),
                  )}
                </div>
              }
            />
          </div>

          <p className="border-t border-line px-3 py-2 text-2xs text-fg-subtle">
            A painted {isKeyboard ? "key" : "LED"} holds its colour through
            every effect and ignores the animation. It lives in the same flash
            region as the rest of lighting, so it is gone on unplug until you
            save.
          </p>
        </Panel>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader>
            <span>{isKeyboard ? "Keyboard lighting" : "Light bar"}</span>
          </PanelHeader>

          <div className="space-y-4 p-4">
            {/*
              The `open` byte is four-state only on the keyboard's dual-LED
              area — north and south switch independently while sharing every
              other setting. A strip is a plain on/off, which is exactly how
              the vendor app splits it too.
            */}
            {dualFace ? (
              <Field
                label="LEDs"
                hint="North and south switch separately but share the effect, brightness, speed and colour."
                control={
                  <div className="flex items-center gap-5">
                    <FaceToggle
                      label="Top"
                      description="North-facing, through the keycap"
                      on={faceIsOn(base.open, LightFace.North)}
                      onChange={(on) =>
                        set({ open: withFace(base.open, LightFace.North, on) })
                      }
                    />
                    <FaceToggle
                      label="Underglow"
                      description="South-facing, under the board"
                      on={faceIsOn(base.open, LightFace.South)}
                      onChange={(on) =>
                        set({ open: withFace(base.open, LightFace.South, on) })
                      }
                    />
                  </div>
                }
              />
            ) : (
              <Field
                label="Lighting"
                control={
                  <FaceToggle
                    label={lit ? "On" : "Off"}
                    on={lit}
                    onChange={(on) => set({ open: on ? 1 : 0 })}
                  />
                }
              />
            )}

            <Field
              label="Mode"
              htmlFor={`effect-${area}`}
              hint={
                isStatic
                  ? cyclesHue
                    ? "Held, but cycling hues — the palette's cycle slot is selected."
                    : "A single colour, held. Pick it from the palette."
                  : (effect?.description ??
                    `${effect ? effectLabel(effect.id, effect.name) : "Unknown"} animates on the board itself.`)
              }
              control={
                <Select
                  id={`effect-${area}`}
                  value={base.effect}
                  onValueChange={(value) => set({ effect: Number(value) })}
                  options={effects.map((effect) => ({
                    value: effect.id,
                    label: effectLabel(effect.id, effect.name),
                  }))}
                />
              }
            />

            <Field
              label="Brightness"
              control={
                <SliderRow
                  key={area}
                  value={base.brightness}
                  revision={revision.get(`lighting:${area}`) ?? 0}
                  onCommit={(v) => writeLighting(area, { brightness: v })}
                  ariaLabel="Brightness"
                />
              }
            />

            <Field
              label="Speed"
              control={
                <SliderRow
                  key={area}
                  value={base.speed}
                  max={SPEED_MAX}
                  revision={revision.get(`lighting:${area}`) ?? 0}
                  onCommit={(v) => writeLighting(area, { speed: v })}
                  ariaLabel="Speed"
                />
              }
            />

            {!animates ? (
              <p className="text-2xs text-fg-subtle">
                A static effect holding a fixed colour has nothing to animate —
                speed is stored but won't be visible.
              </p>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <PanelHeader>
            <span>Palette</span>
            <span className="text-2xs font-normal text-fg-muted">
              {isKeyboard ? "Keyboard" : "Light bar"} · 8 slots
            </span>
          </PanelHeader>

          <div className="p-4">
            <div className="grid grid-cols-4 gap-2">
              {slots.map((slot, i) => (
                <SlotSwatch
                  key={i}
                  slot={slot}
                  index={i}
                  active={i === base.paletteSlot}
                  onSelect={() => set({ paletteSlot: i })}
                  onColor={(next) =>
                    void writePalette(
                      area,
                      slots.map((s, j) => (j === i ? next : s)),
                    )
                  }
                />
              ))}
            </div>
            <p className="mt-3 text-2xs leading-relaxed text-fg-muted">
              Slot 1 is the cycling-hue slot: selecting it runs the effect
              through the spectrum instead of holding one colour. Each area
              stores its own eight.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// --- pieces ----------------------------------------------------------------

function FaceToggle({
  label,
  description,
  on,
  onChange,
}: {
  label: string;
  description?: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <Switch checked={on} onCheckedChange={onChange} />
      <span>
        <span className={cn("block text-xs", on ? "text-fg" : "text-fg-muted")}>
          {label}
        </span>
        {description ? (
          <span className="block text-3xs text-fg-subtle">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

function SliderRow({
  value,
  max = 100,
  revision,
  onCommit,
  ariaLabel,
}: {
  value: number;
  max?: number;
  /** Bumped when the board answers for this zone; drives the settle wash. */
  revision: number;
  onCommit: (v: number) => Promise<void>;
  ariaLabel: string;
}) {
  const { draft, drag, commit } = useSliderDraft(onCommit);
  const shown = draft ?? value;

  return (
    <div className="flex items-center gap-3">
      <Slider
        value={[shown]}
        min={0}
        max={max}
        step={5}
        aria-label={ariaLabel}
        onValueChange={([v]) => drag(v ?? 0)}
        onValueCommit={([v]) => {
          if (v !== undefined) commit(v);
        }}
      />
      <Settle revision={revision} className="shrink-0">
        <Readout className="w-10 text-right" value={String(shown)} unit="%" />
      </Settle>
    </div>
  );
}

function SlotSwatch({
  slot,
  index,
  active,
  onSelect,
  onColor,
}: {
  slot: PaletteSlot;
  index: number;
  active: boolean;
  onSelect: () => void;
  onColor: (slot: PaletteSlot) => void;
}) {
  const isRgbSlot = index === RGB_SLOT;

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        aria-label={
          isRgbSlot ? "Cycling hue slot" : `Palette slot ${index + 1}`
        }
        className={cn(
          "block h-11 w-full rounded-md ring-1 ring-inset transition-shadow",
          active ? "ring-2 ring-accent" : "ring-line hover:ring-line-strong",
        )}
        style={
          isRgbSlot
            ? {
                // Stored as {0,0,0} but it means "cycle" — a black swatch would
                // misreport what the slot does.
                backgroundImage:
                  "conic-gradient(from 0deg, #f85149, #d29922, #3fb950, #2f81f7, #a371f7, #f85149)",
              }
            : { backgroundColor: `rgb(${slot.r} ${slot.g} ${slot.b})` }
        }
      />
      {isRgbSlot ? (
        <p className="text-center text-3xs text-fg-muted">Cycle</p>
      ) : (
        <input
          type="color"
          aria-label={`Colour for slot ${index + 1}`}
          value={hex(slot)}
          onChange={(e) => onColor({ ...slot, ...fromHex(e.target.value) })}
          className="h-5 w-full cursor-pointer rounded bg-canvas-overlay ring-1 ring-inset ring-line"
        />
      )}
    </div>
  );
}

const rgbCss = ({ r, g, b }: Rgb): string => `rgb(${r} ${g} ${b})`;

/** Pick whichever design-token foreground has the stronger WCAG contrast. */
function contrastText(rgb: Rgb): string {
  const luminance = ({ r, g, b }: Rgb) => {
    const channel = (value: number) => {
      const linear = value / 255;
      return linear <= 0.04045
        ? linear / 12.92
        : ((linear + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const background = luminance(rgb);
  const dark = luminance({ r: 13, g: 17, b: 23 });
  const light = luminance({ r: 240, g: 246, b: 252 });
  const darkContrast = (background + 0.05) / (dark + 0.05);
  const lightContrast = (light + 0.05) / (background + 0.05);
  return darkContrast >= lightContrast ? "#0d1117" : "#f0f6fc";
}

const hex = (slot: PaletteSlot): string =>
  `#${[slot.r, slot.g, slot.b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

const toHex = ({ r, g, b }: Rgb): string =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function fromHex(value: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(value.slice(1, 3), 16) || 0,
    g: parseInt(value.slice(3, 5), 16) || 0,
    b: parseInt(value.slice(5, 7), 16) || 0,
  };
}
