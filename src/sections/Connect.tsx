import { Usb, TriangleAlert, Loader2, FlaskConical } from "lucide-react";
import { useDevice } from "@/store/device";
import { Button, Panel } from "@/components/ui";

export function Connect() {
  const { status, error, connect, connectSimulated } = useDevice();
  const reconnecting = status === "reconnecting";

  if (status === "unsupported") return <Unsupported />;

  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <div className="w-full max-w-md">
        <Panel className="p-6">
          <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-md border border-line bg-canvas-overlay">
            <Usb size={18} strokeWidth={1.75} className="text-fg-muted" />
          </div>

          <h2 className="text-base font-semibold text-fg">
            {reconnecting ? "Keyboard restarting" : "Connect your keyboard"}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
            {reconnecting
              ? "The report-rate change briefly resets USB. The driver will reconnect and read the board automatically."
              : "Plug the AE68 Pro in over USB, then grant access. Your browser remembers the permission, so this only happens once."}
          </p>

          {error ? (
            <div className="mt-4 flex gap-2 rounded-md border border-danger/40 bg-danger-subtle p-2.5">
              <TriangleAlert
                size={14}
                className="mt-px shrink-0 text-danger"
                strokeWidth={2}
              />
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg">
                  Could not connect
                </p>
                <p className="mt-0.5 text-2xs leading-relaxed text-fg-muted">
                  {error}
                </p>
              </div>
            </div>
          ) : null}

          <Button
            variant="primary"
            className="mt-5 h-8 w-full"
            disabled={status === "connecting" || reconnecting}
            onClick={() => void connect()}
          >
            {status === "connecting" || reconnecting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {reconnecting ? "Reconnecting" : "Reading the board"}
              </>
            ) : (
              <>
                <Usb size={14} />
                Choose keyboard
              </>
            )}
          </Button>

          <p className="mt-3 text-3xs leading-relaxed text-fg-subtle">
            Only one app can hold the keyboard at a time. If the vendor
            configurator is open, close it first. If you're on Linux and the
            keyboard appears but won't connect,{" "}
            <a
              href="https://github.com/inferno0230/everglide-ae68-pro-driver#linux-permissions"
              target="_blank"
              rel="noreferrer"
              className="text-fg-muted underline underline-offset-2 hover:text-fg"
            >
              fix device permissions
            </a>
            .
          </p>
        </Panel>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-line bg-canvas-subtle px-3 py-2.5">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs text-fg">
              <FlaskConical size={14} className="text-fg-muted" />
              No keyboard to hand?
            </p>
            <p className="mt-0.5 text-2xs text-fg-muted">
              Explore with a simulated board. Its data is synthetic.
            </p>
          </div>
          <Button
            className="shrink-0"
            onClick={() => void connectSimulated()}
            disabled={status === "connecting" || reconnecting}
          >
            Open demo
          </Button>
        </div>
      </div>
    </div>
  );
}

function Unsupported() {
  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <Panel className="w-full max-w-md p-6">
        <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-md border border-attention/40 bg-attention-subtle">
          <TriangleAlert size={18} strokeWidth={1.75} className="text-attention" />
        </div>
        <h2 className="text-base font-semibold text-fg">
          This browser can't reach USB devices
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
          Talking to the keyboard needs WebHID, which today only ships in
          Chromium-based browsers — Chrome, Edge, Brave, Opera or Arc. Firefox
          and Safari have not implemented it.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-fg-muted">
          Open this page in one of those and it will connect.
        </p>
      </Panel>
    </div>
  );
}
