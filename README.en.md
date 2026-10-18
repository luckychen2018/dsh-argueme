# dsh-argueme · Round Self-Review

> DSH (DeepSeek Harness) plugin: after every completed round you started, it automatically asks the assistant a **first-principles critique** follow-up (default 「第一性原理复核」), so the assistant reviews its own previous answer.
>
> Includes a config card on the Web **Plugins** page: on/off switch + editable follow-up prompt.

- Package: `dsh-argueme`
- Plugin row id: `dsh-argueme`
- Follow-up message source: `plugin:dsh-argueme` (never mistakable for a human prompt)

## Features

- After each **human-authored** turn ends normally, queue one automatic user-role follow-up asking the assistant to critique itself.
- Built-in follow-up prompt is a structured **first-principles review** template (goal restore → facts vs assumptions → re-derive → holes by severity → minimal fix → verdict).
- **Loop-safe by construction**: only turns whose first claimed prompt has `source.kind === 'user'` trigger it; the plugin's own message carries `plugin:dsh-argueme`, so it can never trigger itself. Unknown-origin turns never trigger, plus a consecutive-turn fuse.
- Configuration panel on the Plugins page (`plugins.bundle.config` + `plugins.row.config`): toggle, and a multi-line prompt editor where the built-in prompt shows as placeholder text. Leave it empty to use the built-in prompt.
- Root sessions only by default (subagents / workflows / Agent Teams are skipped).

## Install

### A: DSH Desktop Plugins page (recommended)

1. Clone this repository to any local directory.
2. Run `pnpm install` in that directory (installs the host dependency `@deepseek-ai/schemastery`).
3. Open the sidebar **Plugins** page and install this bundle **from the local directory**; or call
   `plugin_manager install_bundle { target: "<absolute path>" }`.
4. Enable the `dsh-argueme` row. Refresh the page once so the client half (config card) is loaded.

> This package is not published to npm yet, so installing by package name is not supported.
> Whether a GitHub URL is accepted by the install UI depends on the build; cloning first is the safe path.

### B: With the `dsh` CLI

```bash
cd /path/to/dsh-argueme
pnpm install
dsh plugin --profile <profile> add <absolute path>
```

> The `pnpm dsh ...` form only works inside a Harness source workspace (this repo has no `dsh` dependency).

### Local development

After editing `client.js`, reinstall the bundle (or restart the app) and refresh the Web page so the new client module is served.

## Configure

Open **Plugins → dsh-argueme**: the card appears under the description, and the `dsh-argueme` row also gets a **Configure** control.

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Live-editable. Off = never auto-send. |
| `prompt` | string | `""` (empty = built-in prompt) | Live-editable. Empty uses the built-in first-principles review prompt; typing overrides it. |
| `includeGoalRounds` | boolean | `false` | Also critique each automatic goal round (live-editable). **Off by default**. When on, it does not add a turn: the critique is injected into the next goal round's context as model-facing input, so goal-round-driver does not see a competing prompt and the goal loop keeps running. At most once per round; pending injections are retracted when the goal pauses/completes/blocks/clears. |
| `includeSubagents` | boolean | `false` | Also react to non-root agent turns (subagents / workflows / Agent Teams). Non-volatile; changing it remounts the row. **Careful**: subagent seeds are `user`-sourced, and the critique can replace a subagent's final answer. |

## Behavior and safety invariants

1. **Human-only**: trigger only when the turn's first claimed prompt has `source.kind === 'user'`. The plugin's own messages use `plugin:dsh-argueme`, so self-triggering is structurally impossible.
2. **Never guess**: if the turn's prompt source was not observed (e.g. the plugin was mounted mid-turn), it does not trigger. Missing one critique is preferred over a wrong one.
3. **Chain fuse**: a turn immediately following an auto follow-up is never triggered.
4. **Completed turns only**: `turn/end` must be `completed`; aborted / error / blocked / max-tokens / interrupted are skipped; pending inbox input is never jumped.

Cost: each human round adds one full model call. Disable the row or set `enabled` to `false` if you do not want that.

### Goal loops (optional)

Goal round prompts come from `source.kind = "goal"`, not `user`, so they are skipped by default. With
`includeGoalRounds` enabled:

- **No extra turn**: the critique is delivered with `inject()` (next-step, without waking the driver)
  into the **next goal round** context; the model sees it in that round's steps.
- **The goal loop keeps running**: queueing a separate follow-up instead would be recorded by
  goal-round-driver as `competingQueued` and pause the goal (0.2.1 behavior).
- **No loop**: at most one injection per round; the injected message is sourced `plugin:dsh-argueme` and
  can never count as a human turn; nothing is injected unless the goal is `active`/`armed` with round
  budget left; pending injections are retracted when the goal pauses/completes/blocks/clears.
- Injection is model-facing context; it does not guarantee a standalone critique answer.

## Built-in follow-up prompt (first principles)

```text
【第一性原理复核 · 只针对你上一轮回答】
不要客套，不要复述。按顺序挑刺：
1) 目标还原：本次请求真正要解决的问题是什么？你的回答命中的是根问题，还是字面问题？
2) 拆到基本事实：列出结论依赖的原始事实、硬约束和已验证证据；把“惯例、常识、大家都这么做、感觉合理”逐条标为假设，并判断哪些其实未经证实。
3) 从基本事实重新推导：去掉所有默认假设后，最直接的解是什么？你的方案是否因此更简单、更正确、代价更低？有差异就说明原因与代价。
4) 找漏洞并按严重度排序：事实错误 > 逻辑跳跃 > 隐藏假设 > 边界条件/反例遗漏 > 未验证结论 > 与目标偏差。每条给出证据或反例，禁止臆测。
5) 给出可直接采纳的修正：最小必要改动（结论/步骤/代码），不要泛泛而谈。
6) 最后一行输出：`结论：可接受`，或 `结论：需要修正：<最小必须修改项>`。若确认无问题，说明依据哪些证据判断它成立；不要为凑数编问题。
```

## Publish & listing

DSH ships **no central official plugin index**: a market is a user-added JSON index source
(see the official guide: [Plugin market](https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market)).
"Getting into the official source" therefore means:

1. **Publish the npm package** (the actual install source; most community indexes read npm):

   ```bash
   npm login --registry=https://registry.npmjs.org
   npm publish --registry=https://registry.npmjs.org
   ```

   The local npm registry points at a mirror (`registry.npmmirror.com`) by default; pass the official
   registry explicitly when publishing.
2. **Request community catalog listing** (community-operated, not a DeepSeek review):
   - `awesome-dsh-plugin/awesome-dsh-plugin`: open a PR following its `contributing.md` review criteria;
     dshmarket points plugin submissions at this catalog.
   - `EasonMWS/dsh-plugin-health`: auto-generated format-1 index from the npm ecosystem; inclusion is not
     a security review.
3. **Self-host an index (no approval)**: this repo ships `market/index.json` (format 1). Publish it with
   GitHub Pages per [market/README.md](market/README.md), then add the URL in DSH under
   **Plugins → Custom plugin markets → Discover → Add index source**.

## Development

```bash
node --check index.js
node --check client.js
node test/plugin.test.mjs   # offline unit tests with a fake ctx/agent bus
```

## Layout

| File | Purpose |
| --- | --- |
| `index.js` | Host half: event wiring, turn gating, auto follow-up, `Config` (volatile `enabled` / `prompt`). |
| `client.js` | Browser half: the Plugins-page config card. |
| `cordis.patch.yml` | Bundle layer inserting the `dsh-argueme` row. |
| `locale/*.json` | Bundle display metadata (title/description) for the Plugins page. |
| `icon.svg` | Bundle icon. |
| `test/plugin.test.mjs` | Offline unit tests. |

## License

MIT
