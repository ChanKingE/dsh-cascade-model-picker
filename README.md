# dsh-cascade-model-picker

**English** | [简体中文](README.zh.md)

A **cascade model picker** for **DeepSeek Harness**: it replaces the composer's two-level
«Model → Effort» drill-down menu with a searchable **provider × model two-column panel**.

<p align="center">
  <img src="docs/cascade-picker-light.png" alt="Light theme: the model picker panel" width="720">
</p>
<p align="center">
  <img src="docs/cascade-picker-dark.png" alt="Dark theme: the model picker panel" width="720">
</p>

## Features

- Takes over the composer's `conversation.input.model` seat and the `/model` command popup
  (both read one per-session directory).
- Panel: header with a «N providers · M models» count, a search field (model and provider names,
  matched text highlighted), the current route as a breadcrumb, a 240px provider rail next to the
  model column, and a keyboard-hint footer.
- Reasoning effort drills down as a single column from the breadcrumb's caption strip.
- **Choosing a model or an effort closes the panel immediately**; clicking a provider only switches
  the model column. A rejected selection is reported through the shared Toast instead of failing silently.
- Accessible by construction: real focusable `option` / `listbox` / `dialog` elements, `↑`/`↓` inside a
  column, `←`/`→` across columns, `Enter` to choose, `Esc` to leave one level at a time.
- Every color comes from `--dsw-*` design variables, so the panel follows the light/dark theme and stays opaque.

## Requirements

- Verified on **DSH desktop 0.2.0-rc.2**. The panel uses the 0.2.x icon export names
  (`IconXxxOutlineRegular`); the 0.1.x `IconXxxOutline16` / `...14` names crash the whole slot
  (React error #130) and the seat disappears.
- The shell must serve these module-table entries: `react`, `react/jsx-runtime`,
  `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-primitives`.

## Install

### Desktop app (recommended: Plugin Hub)

Settings → Plugin Hub → GitHub, and enter `<your-user>/dsh-cascade-model-picker`.

> The desktop's `desktop` profile is owned by the Electron application; `dsh plugin --profile desktop add …`
> is rejected with `error: profile "desktop" is managed exclusively by the Electron application`.
> Use the in-app Plugin Hub instead.

### Other profiles (CLI)

```bash
dsh plugin --profile <profile> add github:<your-user>/dsh-cascade-model-picker
```

Client halves load at **boot**: refresh the page, and restart the desktop app completely.

## How it mounts

The composer seat belongs to a row declared by the built-in `@deepseek-ai/dsh-web-app` bundle:

```yaml
- id: ui-model-selection
  name: '@deepseek-ai/dsh-client-ui-model-selection'
```

A patch layer **cannot rename a row**: the Loader compares the patched `name` with the declared one and
drops the whole patch on a mismatch (`patch: name mismatch for "ui-model-selection" …, skipping`). So this
plugin uses its own `dsh.bundle.patch` ([`cordis.patch.yml`](cordis.patch.yml)) for the two supported moves:

1. `insert` its own row `cascade-model-selection` pointing at this package — its client half registers the
   **same seat name**;
2. restate the built-in row by `id` (the `name` must be repeated verbatim) and set `disabled: true`, which
   removes the built-in menu from the client module table so only one component owns the seat.

```yaml
- insert:
    - id: cascade-model-selection
      name: 'dsh-cascade-model-picker'
- id: ui-model-selection
  name: '@deepseek-ai/dsh-client-ui-model-selection'
  disabled: true
```

> Two patch-layer gotchas: `insert:` adds a row while a bare row only overrides an existing one
> (overriding an unknown id reports `patch: entry "…" not found`), and an override must restate every key
> the row needs, not just the changed one.

## Build from source

```bash
pnpm install
pnpm run bundle     # tsdown → lib/index.js, lib/invariant.js, lib/client.js
```

The built `lib/` is committed, so installing straight from GitHub needs no local build.

## Uninstall

Remove it in the Plugin Hub, or `dsh plugin --profile <profile> remove dsh-cascade-model-picker`, then
restart to get the built-in menu back.

## License

[MIT](LICENSE)
