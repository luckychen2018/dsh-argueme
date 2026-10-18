# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [Semantic Versioning](https://semver.org/).

## [1.4.0] - 2026-10-18

### Changed
- `includeGoalRounds` now inserts a **separate critique turn** between goal rounds
  (goal round N → critique turn → goal round N+1) instead of injecting the critique into the next
  goal round's context. The turn is queued synchronously during the idle transition, before
  goal-round-driver's asynchronous continuation, so the driver backs off (`competingQueued`) and the
  goal loop resumes after the critique turn instead of being paused.

## [1.3.0] - 2026-10-18

### Added
- `includeGoalRounds` (volatile, default `false`): optional critique for goal auto-rounds.
  - Delivered with `agent.inject()` into the next goal round's step context, so goal-round-driver never
    sees a competing next-turn prompt and the goal loop keeps running.
  - At most one injection per goal round; only while the goal is `active`/`armed` with round budget
    left; pending injections are retracted when the goal pauses/completes/blocks/clears.
  - Plugins-page switch for it; the injected message keeps source `plugin:dsh-argueme`, so it can never
    be mistaken for a human turn (no self-trigger loop).

## [1.2.3] - 2026-10-18

### Added
- `engines.dsh` (`>=0.2.0-rc.2 <0.3.0`) so plugin-market indexes can compute DSH compatibility.
- `market/index.json` — a ready format-1 plugin market index (self-hostable via GitHub Pages) plus
  `market/README.md` with hosting and listing instructions.

## [1.2.2] - 2026-10-18

### Fixed
- Plugins-page config card: the save button used `--dsw-alias-brand-primary` as background, which is
  near-white in the dark theme, producing a white-on-white button. It now follows the host's native
  primary-button tokens (`label-primary` background, `bg-layer-3` text) and gets hover/focus styles.
- Prompt editor now uses the host input surface (`bg-layer-3`, `border-l4`) and `label-dimmed`
  placeholder color.

## [1.2.1] - 2026-10-18

### Changed
- The prompt editor is now a multi-line textarea; the built-in first-principles review prompt is
  shown as placeholder text instead of being stored as the value.
- `Config.prompt` defaults to an empty string: empty means "use the built-in prompt"; typing a value
  overrides it, clearing it restores the built-in prompt.

## [1.2.0] - 2026-10-18

### Changed
- Renamed the plugin from `@local/round-review` / row id `round-review` to `dsh-argueme` / row id
  `dsh-argueme`; the injected message source is now `plugin:dsh-argueme`.
- Added release metadata: repository/homepage/bugs, LICENSE, CHANGELOG, English README.

## [1.1.1] - 2026-10-18

### Fixed
- Client half: register the config cards unconditionally (no more "waiting for the form" gate) and
  try both `dsh-argueme` and `include:dsh-argueme` settings namespaces, so a namespace mismatch can no
  longer hide the panel silently.
- Set `dsh.client.immediately: true` so the client module activates on boot.

## [1.1.0] - 2026-10-18

### Added
- Native Plugins-page configuration card built on DSH's settings form generation:
  - host `Config` with volatile `enabled` / `prompt` fields (auto-discovered by `dsh-settings`);
  - client half registering `plugins.bundle.config` and `plugins.row.config` cards.

## [1.0.0] - 2026-10-18

### Added
- Initial release: Host-only Cordis plugin that queues one automatic critique follow-up after each
  completed human-authored round.
- Loop safety invariants: human-source gate, no-guess rule for unobserved turns, consecutive-turn
  fuse, completed-only processing, pending-inbox guard, root-agent gating, unload cleanup.
- Offline unit test suite (16+ cases) with a fake context / agent event bus.
