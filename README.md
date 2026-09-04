# Everglide AE68 Pro Web Driver

An unofficial, local web configurator for the **Everglide AE68 Pro** magnetic
keyboard. It talks to the keyboard directly through WebHID—no vendor account,
telemetry, or remote configuration service required.

> [!IMPORTANT]
> This is an independent community project. It is not affiliated with or
> endorsed by Everglide, Sparklink, or PlayJoy. It currently targets the AE68
> Pro only.

Nothing is wired to hardware yet. This commit is the toolchain and the empty
application shell the driver will be built into.

## Requirements

- A desktop Chromium browser with WebHID. Chrome and Edge are recommended.
- [Bun](https://bun.sh/) 1.4.1 or newer.

Firefox and Safari do not currently provide WebHID. A hosted copy must be
served over HTTPS; `localhost` is accepted as a secure development context.

## Development

```bash
bun install --frozen-lockfile

bun run dev        # development server
bun run typecheck  # type checking
bun run build      # production build
bun run preview    # preview the production build
```

The production output is written to `dist/`.

## License

Released under the [MIT License](LICENSE).
