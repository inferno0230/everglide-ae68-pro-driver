export default function App() {
  return (
    <div className="flex h-screen items-center justify-center bg-canvas p-8">
      <div className="w-full max-w-md rounded-md border border-line bg-canvas-inset p-6">
        <h1 className="text-base font-semibold text-fg">
          Everglide AE68 Pro
        </h1>
        <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">
          An unofficial, local WebHID configurator. Nothing talks to the
          keyboard yet — this is the shell the driver will render into.
        </p>
      </div>
    </div>
  );
}
