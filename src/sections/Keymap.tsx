import * as React from "react";
import { Search, MousePointerClick } from "lucide-react";
import { useDevice } from "@/store/device";
import { KeyboardView, type KeyGeometry } from "@/components/KeyboardView";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelHeader,
  Readout,
  Segmented,
} from "@/components/ui";
import {
  byGroup,
  capLabel,
  describe as describeKey,
  GROUP_LABELS,
  Keycode,
  type KeycodeGroup,
} from "@/hid/keycodes";
import { cn } from "@/lib/utils";

const LAYERS = [
  { value: 0, label: "Main" },
  { value: 1, label: "Fn1" },
  { value: 2, label: "Fn2" },
  { value: 3, label: "Fn3" },
] as const;

/** Groups worth offering for this board, in the order a user reaches for them. */
const GROUPS: KeycodeGroup[] = [
  "basic",
  "special",
  "macro",
  "media",
  "mouse",
  "control",
  "lighting",
  "gamepad",
];

const KEYBOARD_SECTIONS = [
  "Letters",
  "Numbers",
  "Symbols",
  "Function keys",
  "Extra keys",
] as const;

type KeyboardSection = (typeof KEYBOARD_SECTIONS)[number];

/** Keep the HID catalogue's natural order, but give the long list landmarks. */
function keyboardSection(code: number): KeyboardSection {
  if (code >= 0x04 && code <= 0x1d) return "Letters";
  if (code >= 0x1e && code <= 0x27) return "Numbers";
  if (code >= 0x2d && code <= 0x38) return "Symbols";
  if (
    (code >= 0x3a && code <= 0x45) ||
    (code >= 0x68 && code <= 0x73)
  ) {
    return "Function keys";
  }
  return "Extra keys";
}

export function KeymapSection() {
  const { snapshot, keymap, layer, setLayer, selection, select, writeKeycode } =
    useDevice();
  const [group, setGroup] = React.useState<KeycodeGroup>("basic");
  const [query, setQuery] = React.useState("");

  const keys = snapshot?.keys ?? [];
  const selectedId = [...selection][0];
  const selectedKey = keys.find(
    (k) => `${k.row}:${k.col}` === selectedId,
  );

  const label = React.useCallback(
    (key: KeyGeometry) => {
      return capLabel(keymap[layer]?.[key.row]?.[key.col] ?? 0);
    },
    [keymap, layer],
  );

  const state = React.useCallback(
    (key: KeyGeometry) => {
      const kc = keymap[layer]?.[key.row]?.[key.col] ?? 0;
      // On a non-main layer, transparent keys are inert — dim them so the keys
      // that actually do something on this layer stand out.
      return layer > 0 && kc === Keycode.Transparent
        ? { dim: true }
        : undefined;
    },
    [keymap, layer],
  );

  const options = React.useMemo(() => {
    const all = byGroup(group);
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter((o) => o.label.toLowerCase().includes(q));
  }, [group, query]);

  if (!snapshot) return null;

  const current = selectedKey
    ? (keymap[layer]?.[selectedKey.row]?.[selectedKey.col] ?? 0)
    : null;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader>
          <span>Layer</span>
          <Segmented
            size="sm"
            value={layer}
            onChange={setLayer}
            options={LAYERS.map((l) => ({ ...l }))}
          />
        </PanelHeader>

        <div className="overflow-x-auto p-4">
          <KeyboardView
            keys={keys}
            selection={selection}
            onSelect={(id) => select([id])}
            label={label}
            state={state}
            ariaLabel="Select a key to remap"
          />
        </div>

        <p className="border-t border-line px-3 py-2 text-2xs text-fg-muted">
          {layer === 0
            ? "The base layer. Every key here is what the board sends on its own."
            : "▽ is a transparent key — it falls through to the layer below."}
        </p>
      </Panel>

      {!selectedKey ? (
        <Panel>
          <EmptyState
            icon={<MousePointerClick size={22} strokeWidth={1.5} />}
            title="No key selected"
          >
            Pick a key above, then choose what it should send on the{" "}
            {LAYERS[layer]?.label ?? "current"} layer.
          </EmptyState>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader>
            <span className="flex items-center gap-2">
              Assign key
              <Badge tone="accent">
                row {selectedKey.row} · col {selectedKey.col}
              </Badge>
            </span>
            <span className="flex items-center gap-2 font-normal">
              <span className="text-2xs text-fg-muted">Currently</span>
              <Readout
                value={current ? describeKey(current) : "unmapped"}
                tone="accent"
                size="sm"
              />
            </span>
          </PanelHeader>

          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <Segmented
              size="sm"
              value={group}
              onChange={setGroup}
              options={GROUPS.map((g) => ({ value: g, label: GROUP_LABELS[g] }))}
            />
            <div className="relative ml-auto">
              <Search
                size={14}
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-subtle"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter"
                aria-label="Filter keycodes"
                className={cn(
                  "h-6 w-36 rounded-md border border-line bg-canvas-inset pr-2 pl-6",
                  "text-2xs text-fg placeholder:text-fg-subtle",
                  "transition-colors hover:border-line-strong focus:border-accent",
                )}
              />
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto p-2">
            {options.length === 0 ? (
              <p className="px-2 py-6 text-center text-2xs text-fg-muted">
                Nothing in {GROUP_LABELS[group]} matches “{query}”.
              </p>
            ) : group === "basic" ? (
              <div className="space-y-3">
                {KEYBOARD_SECTIONS.map((section) => {
                  const sectionOptions = options.filter(
                    (option) => keyboardSection(option.code) === section,
                  );
                  if (sectionOptions.length === 0) return null;
                  return (
                    <section key={section} aria-label={section}>
                      <h3 className="mb-1.5 text-3xs font-medium tracking-wide text-fg-subtle uppercase">
                        {section}
                      </h3>
                      <div className="flex flex-wrap gap-1">
                        {sectionOptions.map((option) => (
                          <KeycodeButton
                            key={option.code}
                            option={option}
                            active={option.code === current}
                            onSelect={(code) =>
                              void writeKeycode(
                                selectedKey.row,
                                selectedKey.col,
                                code,
                              )
                            }
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {options.map((option) => (
                  <KeycodeButton
                    key={option.code}
                    option={option}
                    active={option.code === current}
                    onSelect={(code) =>
                      void writeKeycode(
                        selectedKey.row,
                        selectedKey.col,
                        code,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {layer > 0 ? (
            <div className="flex items-center justify-between border-t border-line px-3 py-2">
              <p className="text-2xs text-fg-muted">
                Make this key fall through to the layer below.
              </p>
              <Button
                size="sm"
                onClick={() =>
                  void writeKeycode(
                    selectedKey.row,
                    selectedKey.col,
                    Keycode.Transparent,
                  )
                }
              >
                Set transparent
              </Button>
            </div>
          ) : null}
        </Panel>
      )}
    </div>
  );
}

function KeycodeButton({
  option,
  active,
  onSelect,
}: {
  option: { code: number; label: string };
  active: boolean;
  onSelect: (code: number) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(option.code)}
      className={cn(
        "h-6 rounded-md px-2 text-2xs ring-1 ring-inset transition-[background-color,color,box-shadow]",
        active
          ? "bg-accent-subtle text-accent ring-accent"
          : "bg-canvas-overlay text-fg-muted ring-line hover:text-fg hover:ring-line-strong",
      )}
    >
      {option.label}
    </button>
  );
}
