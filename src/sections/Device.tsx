import { useDevice } from "@/store/device";
import {
  Badge,
  Panel,
  PanelHeader,
  Readout,
} from "@/components/ui";

export function DeviceSection() {
  const { snapshot, simulated } = useDevice();

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

    </div>
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
