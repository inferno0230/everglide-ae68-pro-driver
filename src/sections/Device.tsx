import { useDevice } from "@/store/device";
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Panel,
  PanelHeader,
  Readout,
  Select,
} from "@/components/ui";
import { REPORT_RATES, SaveTarget } from "@/hid/protocol/constants";

export function DeviceSection() {
  const {
    snapshot,
    simulated,
    setReportRate,
    factoryReset,
    renameProfile,
  } = useDevice();

  if (!snapshot) return null;
  const { info, protocol, feature, ledZones } = snapshot;
  const keyZone = ledZones.find((zone) => zone.index === 0);
  const lightBarZones = ledZones.filter((zone) => zone.index !== 0);
  const keyCount = snapshot.keys.length;
  // The AE68 Pro spacebar has five LEDs per face instead of one, adding four
  // addresses to each of the otherwise one-LED-per-key north/south faces.
  const keyLedsPerFace = keyCount + 4;
  const totalAddressableLeds =
    keyLedsPerFace * (snapshot.dualLighting ? 2 : 1) +
    lightBarZones.reduce((total, zone) => total + zone.rows * zone.cols, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader>
            <span>Identity</span>
            {simulated ? <Badge tone="attention">Simulated</Badge> : null}
          </PanelHeader>
          <dl className="divide-y divide-line-muted">
            <Row label="Firmware" value={info.appVersion} />
            <Row label="PCB revision" value={info.pcbVersion} />
            <Row
              label="Protocol"
              value={`${protocol.main}.${protocol.sub}`}
            />
            <Row label="Serial" value={info.serialNumber} />
            <Row
              label="Board ID"
              value={`0x${info.boardId.toString(16).toUpperCase().padStart(8, "0")}`}
            />
            <Row label="Built" value={formatBuilt(info.buildTimestamp)} />
          </dl>
        </Panel>

        <Panel>
          <PanelHeader>
            <span>Capabilities</span>
          </PanelHeader>
          <dl className="divide-y divide-line-muted">
            <Row
              label="Switches"
              value={feature.axis.magnetic ? "Magnetic (Hall)" : "Mechanical"}
            />
            <Row
              label="Connection"
              value={[
                feature.connection.usb && "USB",
                feature.connection.wireless24g && "2.4 GHz",
                feature.connection.ble && "Bluetooth",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            <Row
              label="Lighting"
              value={
                feature.basic.rgb
                  ? `${totalAddressableLeds} addressable LEDs`
                  : "None"
              }
            />
            {keyZone ? (
              <Row
                label="Per-key RGB info"
                value={
                  snapshot.dualLighting
                    ? `${keyLedsPerFace} north + ${keyLedsPerFace} south LEDs across ${keyCount} keys · ${keyZone.effectCount} effects`
                    : `${keyLedsPerFace} RGB LEDs across ${keyCount} keys · ${keyZone.effectCount} effects`
                }
              />
            ) : null}
            {lightBarZones.map((z) => (
              <Row
                key={z.index}
                label={z.index === 1 ? "Bottom RGB info" : `RGB zone ${z.index}`}
                value={`${z.rows * z.cols} RGB LEDs · ${z.effectCount} effects`}
              />
            ))}
            <Row
              label="RT precision"
              /* Real boards report 0.001 mm; two decimals rounded that to 0.00. */
              value={`${snapshot.rtPrecisionMm.toFixed(3)} mm`}
            />
          </dl>
        </Panel>
      </div>

      <Panel>
        <PanelHeader>
          <span>Settings</span>
        </PanelHeader>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field
            label="Report rate"
            htmlFor="rate"
            hint="How often the board reports to the host."
            control={
              <Select
                id="rate"
                value={snapshot.reportRateHz}
                onValueChange={(value) => void setReportRate(Number(value))}
                options={REPORT_RATES.map((rate) => ({
                  value: rate.hz,
                  label:
                    rate.hz >= 1000
                      ? `${rate.hz / 1000} kHz`
                      : `${rate.hz} Hz`,
                }))}
              />
            }
          />
          <ProfileNames onRename={renameProfile} profiles={snapshot.profiles} />
        </div>
      </Panel>

      <Panel className="border-danger/30">
        <PanelHeader className="border-danger/30 text-danger">
          <span>Factory reset</span>
        </PanelHeader>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="max-w-md text-2xs leading-relaxed text-fg-muted">
            Restores the board's defaults. Calibration data is kept separate, so
            resetting settings will not force you to recalibrate.
          </p>
          <div className="flex gap-2">
            <ConfirmDialog
              trigger={<Button variant="danger">Reset actuation</Button>}
              title="Reset all actuation settings?"
              description="This replaces every key's actuation and rapid-trigger settings with the keyboard defaults."
              confirmLabel="Reset actuation"
              onConfirm={() => void factoryReset(SaveTarget.Performance)}
            />
            <ConfirmDialog
              trigger={<Button variant="danger">Reset keymap</Button>}
              title="Reset the entire keymap?"
              description="This replaces the assignments on every layer with the keyboard defaults."
              confirmLabel="Reset keymap"
              onConfirm={() => void factoryReset(SaveTarget.Layout)}
            />
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ProfileNames({
  profiles,
  onRename,
}: {
  profiles: ReadonlyArray<{ index: number; name: string }>;
  onRename: (index: number, name: string) => Promise<void>;
}) {
  return (
    <Field
      label="Profile names"
      hint="Stored on the board, up to 32 bytes each."
      control={
        <div className="space-y-1.5">
          {profiles.map((p) => (
            <input
              key={p.index}
              defaultValue={p.name}
              aria-label={`Name for profile ${p.index + 1}`}
              maxLength={32}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== p.name) void onRename(p.index, next);
              }}
              className="h-7 w-full rounded-md border border-line bg-canvas-overlay px-2 text-xs text-fg transition-colors hover:border-line-strong focus:border-accent"
            />
          ))}
        </div>
      }
    />
  );
}

/**
 * The board stores its build stamp as `YYYYMMDDHH:MM:SS` with no separator
 * between the date and the hour, which reads as one long number. Space it out
 * when it matches that shape, and pass anything else through untouched.
 */
function formatBuilt(raw: string): string {
  const m = /^(d{4})(d{2})(d{2})(d{2}:d{2}:d{2})$/.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}` : raw || "—";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-1.5">
      <dt className="text-2xs text-fg-muted">{label}</dt>
      <dd>
        <Readout value={value || "—"} size="sm" />
      </dd>
    </div>
  );
}
