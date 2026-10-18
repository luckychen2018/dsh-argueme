# 自托管插件市场索引（可选）

本目录包含一个符合 DSH **format-1** 规范的插件市场索引，只收录 `dsh-argueme` 自己。
它不需要任何审核，任何人都可以把它当作自建插件源使用。

## 前置条件

先发布 npm 包（索引里的版本 `source.type = "npm"`）：

```bash
npm login --registry=https://registry.npmjs.org
npm publish --registry=https://registry.npmjs.org
```

发布后把 `market/index.json` 里对应版本的 `publishTimestamp` 改成实际发布时间（Unix 秒），
并在发新版本时同步追加版本项。

## 用 GitHub Pages 发布索引

1. 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`。
2. 等 Pages 构建完成后，索引地址为：

```
https://luckychen2018.github.io/dsh-argueme/market/index.json
```

（`icon` 写的是 `../icon.svg`，相对索引地址解析为仓库根目录的 `icon.svg`。）

3. 在 DSH Web：**Plugins → Experimental plugins 旁的 More → 打开「自定义插件市场」**
   → **发现 → 添加索引源**，粘贴上面的索引地址。

## 提交到社区聚合索引（需要审核/收录流程）

见仓库根 README 的「发布与收录」一节；常见去处：

- `awesome-dsh-plugin/awesome-dsh-plugin`（社区目录，`contributing.md` 定义评审标准；dshmarket 的提交入口指向它）
- `EasonMWS/dsh-plugin-health`（自动生成的 format-1 索引，从 npm 生态抓取，收录不代表安全审核）

## 校验

索引必须通过 `@deepseek-ai/dsh-plugin-market-index` 校验：`format = 1`、每个插件至少一个版本、
版本必须是精确 SemVer、`source` 只能是 `npm` 或带 40 位 commit 的 `git`。
