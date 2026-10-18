# dsh-argueme · 每轮自审（自动追问）

[English](README.en.md) | 中文

DSH（DeepSeek Harness）插件：每轮**由你发起**的对话正常结束后，自动以用户角色再发一次追问
（内置「第一性原理复核」文案），让助手复核自己上一轮的回答。

- 包名 / 插件行 id：`dsh-argueme`
- 注入消息来源：`plugin:dsh-argueme`（与人类消息在类型上可区分）
- 附带 Web **Plugins** 页配置卡片：自动追问开关 + 可编辑追问内容

## 功能

- 监听每轮结束（`agent/status → idle` 且 `turn/end` 原因为 `completed`）。
- 只有当本轮**首条被领取的 prompt 来源是 `user`** 时，才通过 `agent.followup()` 追发一条
  用户角色的消息；默认内容是结构化的**第一性原理复核**模板（见下）。
- 内置防死循环设计（见「安全设计」）。
- 默认只对 root 会话生效，不打扰 subagent / workflow / Agent Teams。

## 安装

### 方式 A：DSH Desktop 插件页（推荐）

1. 先把仓库 clone 到本地任意目录。
2. 在该目录执行 `pnpm install`（安装 Host 端依赖 `@deepseek-ai/schemastery`）。
3. 打开侧边栏 **Plugins** 页，用**本地目录**安装本 bundle；或让 agent 调用
   `plugin_manager install_bundle { target: "<本目录绝对路径>" }`。
4. 启用 `dsh-argueme` 行；**刷新一次页面**，让 client 半边（配置卡片）加载。

> 未经 npm 发布，所以暂不支持直接用包名安装；GitHub 地址的安装入口是否可用取决于具体构建，
> 稳妥做法是先 clone 再按本地目录安装。

### 方式 B：已安装 `dsh` CLI

```bash
cd /path/to/dsh-argueme
pnpm install
dsh plugin --profile <profile> add <本目录绝对路径>
```

> `pnpm dsh ...` 写法只在 Harness 源码工作区可用（本仓库不含 dsh 依赖）。

### 本地开发

修改 `client.js` 后需要重新安装 bundle（或重启 App），并刷新 Web 页面，新的 client 模块才会生效。

## 配置（Plugins 页面板）

打开 **Plugins → dsh-argueme**：配置卡片出现在描述下方；`dsh-argueme` 行右侧也有「配置/Configure」入口。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | 总开关，面板内实时生效。`false` 时不再自动追问。 |
| `prompt` | string | `""`（空 = 内置文案） | 追问内容；留空使用内置「第一性原理复核」文案，填写则覆盖。面板为多行输入框，内置文案以灰色背景字显示。 |
| `includeGoalRounds` | boolean | `false` | 是否在 goal 自动循环的每一轮也挑刺（面板内实时生效）。**默认关闭**。开启后不新增 turn，而是把挑刺请求注入下一轮 goal 的上下文（不会产生 goal-round-driver 眼中的 competing prompt，goal 循环继续跑）；每轮最多一次，goal 结束/暂停/清空时撤回未领取的注入。 |
| `includeSubagents` | boolean | `false` | 是否也响应非 root agent 的轮次（子代理 / workflow / Agent Teams）。**默认关闭是有意的**：子代理的初始 prompt 也是 `user` 来源，开启后每个子代理首轮都会被追问一次，且子代理的最终输出可能变成那段自审而不是任务结果。非 volatile 字段，改动会重挂该插件行。 |

> 面板依赖 Web 客户端加载本插件的 client 半边。安装/升级后若暂未看到卡片，刷新一次页面即可。

## 安全设计（四条硬性不变量）

1. **只认人类轮次**：来源不是 `user` 的轮次（插件注入、goal、团队消息、子代理等）一律不触发；
   插件自己发的追问来源是 `plugin:dsh-argueme`，**在结构上不可能**被识别为人类轮次。
2. **绝不猜测**：如果本轮没有观察到 prompt 的领取记录（例如插件在某轮进行中才装载），
   一律不触发——宁可漏一次，也不盲判。装载后从**下一轮**人类对话起正常生效。
3. **连跳熔断**：若某个 turn 紧跟在上一轮自动追问之后（`turn === 上次触发 turn + 1`），
   即使来源被判定为人类也拒绝触发（独立于来源判断的第二道闸）。
4. **正常结束才算**：`aborted` / `error` / `blocked` / `max-tokens` / `interrupted` 的轮次跳过；
   收件箱还有待领取输入时不插队。因此同一运行内连续发多条消息时，只会在队列清空后的最后一条之后自审一次。

其余约束：每个 turn 最多触发一次；插件卸载时撤回尚未被领取的追问消息。

### goal 循环（可选）

goal 自动轮的 prompt 来源是 `goal` 而不是 `user`，默认不触发挑刺。开启 `includeGoalRounds` 后：

- **不新增 turn**：挑刺文本用 `inject()`（next-step，不唤醒 driver）进入**下一轮 goal** 的上下文；模型在那一轮的步骤里看到它。
- **不打断 goal 循环**：如果改成追加追问（next-turn），goal-round-driver 会把它记为 `competingQueued` 并暂停 goal（0.2.1 行为）——这也是默认关闭的原因。
- **不死循环**：每轮最多注入一次；注入消息来源是 `plugin:dsh-argueme`，永远不会被当作人类轮；goal 非 `active`/`armed` 或回合预算用尽时不注入；goal 暂停/完成/block/clear 时撤回尚未被领取的注入。
- 注入是"模型可见上下文"，不保证模型一定单独输出一段挑刺（它可能把自审并入本轮输出）。

## 内置追问文案（第一性原理）

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

`prompt` 留空时使用 Host 侧 `BUILT_IN_PROMPT`（与上面一致）；填写任何非空内容即覆盖，清空保存则恢复内置文案。

## 成本提示（重要）

每轮用户对话都会**多出一次完整的模型调用**（额外一轮输入 + 输出），token 开销与响应延迟都会增加；
开启 `includeGoalRounds` 后每个 goal 轮还会多一次注入（不新增 turn，但会增加上下文与输出长度）。
不需要时请把 `enabled` 设为 `false`，或在 Plugin Manager 停用该插件。

## 发布与收录

DSH 官方**不托管中央插件索引**：插件市场是「用户自行添加的 JSON 索引源」
（官方文档：[插件市场](https://deepseek-harness.github.io/deepseek-harness/guide/plugin-market)）。
因此「上官方源」实际分三步：

1. **发布 npm 包**（安装的真实来源；多数社区索引从 npm 抓取）：

   ```bash
   npm login --registry=https://registry.npmjs.org
   npm publish --registry=https://registry.npmjs.org
   ```

   本机 npm registry 默认指向镜像（`registry.npmmirror.com`），发布时必须显式指定官方 registry。
2. **提交社区索引收录**（社区目录，非 DeepSeek 官方审核）：
   - `awesome-dsh-plugin/awesome-dsh-plugin`：提交 PR，按其 `contributing.md` 的评审标准；
     dshmarket 的插件提交入口指向该目录。
   - `EasonMWS/dsh-plugin-health`：format-1 索引，从 npm 生态自动生成，收录不代表安全审核。
3. **自建索引源（无需审核）**：本仓库已内置 `market/index.json`（format-1）。
   按 [market/README.md](market/README.md) 用 GitHub Pages 发布后，在 DSH
   **Plugins → 自定义插件市场 → 发现 → 添加索引源** 中粘贴索引 URL。

## 开发

```bash
node --check index.js
node --check client.js
node test/plugin.test.mjs   # 离线单测（假 ctx / agent 事件总线）
```

## 目录

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 端全部逻辑（事件订阅、判定、注入、清理）＋ `Config`（volatile 字段供面板编辑） |
| `client.js` | 浏览器半边：Plugins 页的配置卡片（开关 + 多行追问内容） |
| `cordis.patch.yml` | bundle layer：插入 `dsh-argueme` 行 |
| `locale/zh.json` / `locale/en.json` | 插件标题与描述（Plugins 页展示用） |
| `icon.svg` | 插件图标 |
| `test/plugin.test.mjs` | 离线单元测试 |
| `README.en.md` / `CHANGELOG.md` / `LICENSE` | 英文说明 / 变更记录 / MIT 许可证 |

## License

MIT
