/**
 * dsh-argueme — 每轮自审 · 自动追问（Host-only Cordis plugin）
 *
 * README 需求：每一轮「用户发起」的对话正常结束后，自动以用户角色再问一次
 * 「挑刺」，让助手复核自己上一轮的回答。
 *
 * 这是 clean-room 实现：不参考、不依赖任何旧的 Codex/Claude Code hook 方案，
 * 只用 DSH 0.2.1 的公开 Agent 契约。
 *
 * ── 四条安全不变量（设计即防死循环）────────────────────────────────
 * 1. 只认人类轮次：只有当「本轮首条被领取的 prompt」的 `source.kind === 'user'`
 *    时才触发。插件自己注入的消息 source 固定为 `plugin:dsh-argueme`，在类型上
 *    就永远不可能被识别为人类轮次 —— 自我触发在结构上不可能发生。
 * 2. 绝不猜测：没有观察到本轮 prompt 的领取记录时（例如插件在轮次中途才装载），
 *    一律不触发。宁可漏一次，也不盲判。
 * 3. 连跳熔断：如果某一 turn 紧跟在上一轮自动追问之后（turn === 上次触发 turn + 1），
 *    即使来源判定为人类也拒绝触发。这是独立于来源判断的第二道硬闸。
 * 4. 正常结束才算：只处理 `turn/end` 原因为 `completed` 的轮次；aborted / error /
 *    blocked / max-tokens / interrupted 等一律跳过；收件箱还有待领取输入时不插队。
 *
 * 其余约束：只对 root agent 生效（不干扰 subagent / workflow / Agent Teams）；
 * 每个 turn 最多触发一次；卸载时撤回尚未领取的自动消息。
 *
 * 可配置项（Config）：`enabled` / `prompt` 标记为 volatile，可在 Web 侧边栏
 * Plugins 页本 bundle 的卡片里直接修改并立即生效；`includeSubagents` 是普通
 * 字段，改动会重挂该插件行。未导出表单时也可直接改 profile 的 cordis.patch.yml。
 */

import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'

/** 插件行标识，也写入自动消息的 source.kind。 */
const PLUGIN_ID = 'dsh-argueme'

/** Session format v4 的 producer-owned source kind；字面量 'plugin' 已被弃用。 */
const SOURCE_KIND = `plugin:${PLUGIN_ID}`

/**
 * 内置追问文案（第一性原理复核）。Config.prompt 留空时使用它。
 * 客户端卡片里以 textarea 的 placeholder（背景字）展示同一段文案；
 * 若修改此处，需同步 client.js 的 `promptPlaceholder` 文案。
 */
const BUILT_IN_PROMPT = `【第一性原理复核 · 只针对你上一轮回答】
不要客套，不要复述。按顺序挑刺：
1) 目标还原：本次请求真正要解决的问题是什么？你的回答命中的是根问题，还是字面问题？
2) 拆到基本事实：列出结论依赖的原始事实、硬约束和已验证证据；把“惯例、常识、大家都这么做、感觉合理”逐条标为假设，并判断哪些其实未经证实。
3) 从基本事实重新推导：去掉所有默认假设后，最直接的解是什么？你的方案是否因此更简单、更正确、代价更低？有差异就说明原因与代价。
4) 找漏洞并按严重度排序：事实错误 > 逻辑跳跃 > 隐藏假设 > 边界条件/反例遗漏 > 未验证结论 > 与目标偏差。每条给出证据或反例，禁止臆测。
5) 给出可直接采纳的修正：最小必要改动（结论/步骤/代码），不要泛泛而谈。
6) 最后一行输出：\`结论：可接受\`，或 \`结论：需要修正：<最小必须修改项>\`。若确认无问题，说明依据哪些证据判断它成立；不要为凑数编问题。`

/**
 * 插件配置。Plugins 页配置卡片只展示 `.volatile()` 字段：
 * - `enabled` / `prompt` / `includeGoalRounds`：实时生效，改完立即用于下一轮判定，不重挂插件行；
 * - `includeSubagents`：普通字段，改动会重挂该行（默认关闭，不常改）。
 * `prompt` 默认为空字符串 = 使用内置「第一性原理复核」文案；填写内容则覆盖。
 * `includeGoalRounds` 开启后，每个 goal 自动轮结束会插入一个独立挑刺轮（见 maybeInsertGoalCritique）。
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  prompt: z.string().default('').volatile(),
  includeGoalRounds: z.boolean().default(false).volatile(),
  includeSubagents: z.boolean().default(false),
})

/**
 * 读取一个配置字段。volatile 字段在 resolved config 里是 { get() } 实时引用，
 * 普通字段是普通值；两者都兼容（也兼容单元测试直接传 plain object）。
 */
function readOption(source, name, fallback) {
  const value = source !== null && typeof source === 'object' ? source[name] : undefined
  if (value === undefined) return fallback
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    const live = value.get()
    return live === undefined ? fallback : live
  }
  return value
}

/** 归一化追问文本：空白或非字符串回落到内置「第一性原理复核」文案。 */
function normalizePrompt(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : BUILT_IN_PROMPT
}

/** 人类在输入框发出的消息 source.kind 是 'user'（user-rpc 同样归类为 'user'）。 */
function isHumanMessage(message) {
  const source = message !== null && typeof message === 'object' ? message.source : undefined
  return source !== null && typeof source === 'object' && source.kind === 'user'
}

/** 本插件自己注入的消息。 */
function isOwnMessage(message) {
  const source = message !== null && typeof message === 'object' ? message.source : undefined
  return source !== null && typeof source === 'object' && source.kind === SOURCE_KIND
}

/** goal-round-driver 生成的自动轮 prompt 来源。 */
function isGoalMessage(message) {
  const source = message !== null && typeof message === 'object' ? message.source : undefined
  return source !== null && typeof source === 'object' && source.kind === 'goal'
}

/**
 * 构造一条可直接交给 `agent.followup()` 的完整 UserMessage。
 * 不 import @deepseek-ai/dsh-llm：profile 插件解析到的 dsh 包版本可能与运行中的
 * Host 不一致，而 {id, role, content, source} 是 Agent 公开契约里的稳定形状。
 */
function createPromptMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND },
  }
}

/** 每个 agent 的派生簿记（不产生会话事件）。 */
function createState(agent) {
  return {
    agent,
    /** 有一次 idle 判定尚未消费。 */
    requested: false,
    /** 当前串行 drive 的 Promise。 */
    run: undefined,
    /** 最近一个已结束 turn 的编号。 */
    lastTurn: undefined,
    /** 最近一个 turn 的结束原因 kind。 */
    lastEndReason: undefined,
    /** 最近一次观察到「首条被领取消息」的 turn 编号。 */
    claimedTurn: undefined,
    /** 该 turn 的首条被领取消息（用于判定发起来源）。 */
    claimedPrompt: undefined,
    /** 最近一次观察到 goal prompt 被领取的 turn 编号。 */
    goalTurn: undefined,
    /** 本 agent 已经为哪个 turn 追加过追问。 */
    triggeredTurn: undefined,
    /** 已注入、尚未被领取的自动消息。 */
    pendingMessage: undefined,
    /** 正在卸载。 */
    stopping: false,
  }
}

export const name = PLUGIN_ID

/** 只依赖 Agent 注册表服务。 */
export const inject = ['agents']

export function apply(ctx, rawConfig) {
  const configSource = rawConfig !== null && typeof rawConfig === 'object' ? rawConfig : {}
  const states = new Map()
  let stopping = false

  function warn(message) {
    try {
      ctx.logger?.warn?.(`[${PLUGIN_ID}] ${message}`)
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  /** 是否 root agent（子代理 / workflow / Agent Teams 成员都是 runtime child）。 */
  function isRootAgent(agent) {
    try {
      const roots = ctx.agents.roots()
      if (Array.isArray(roots)) return roots.some((candidate) => candidate === agent || candidate?.id === agent.id)
    } catch {
      /* roots() 不可用时按「非 root」处理，避免误伤子会话 */
    }
    return false
  }

  function stateFor(agent) {
    let state = states.get(agent)
    if (state === undefined) {
      state = createState(agent)
      states.set(agent, state)
    }
    return state
  }

  /** 仍是注册表里同一个活实例。 */
  function isLive(agent) {
    try {
      return ctx.agents.get(agent.id) === agent
    } catch {
      return false
    }
  }

  /** 可选读取 goal 服务：goal 插件未装载时返回 undefined。 */
  function readGoal(agent) {
    try {
      const goals = typeof ctx.get === 'function' ? ctx.get('goals') : undefined
      if (goals === undefined || goals === null || typeof goals.get !== 'function') return undefined
      return goals.get(agent)
    } catch {
      return undefined
    }
  }

  /**
   * goal 轮结束时的独立挑刺轮（可选，默认关闭）。
   *
   * 必须在本轮 idle 的同步阶段插入：goal-round-driver 也在同一个 idle 上续下一轮，
   * 它只在「看到外来 next-turn 消息」时退让（competingQueued），且退让检查发生在异步
   * 续轮之前。若晚于它入队，就会出现两个 next-turn 消息：挑刺轮跑完后 goal round 仍在
   * 队列里，driver 会把它当作暂停条件并 pause goal。因此这里同步 followup（不经过 setTimeout）。
   */
  function maybeInsertGoalCritique(state) {
    if (readOption(configSource, 'enabled', true) === false || stopping || state.stopping) return
    if (typeof ctx.fiber?.state === 'number' && ctx.fiber.state !== 2) return
    if (readOption(configSource, 'includeGoalRounds', false) !== true) return
    const { agent } = state
    if (!isLive(agent) || agent.status !== 'idle') return
    if (state.pendingMessage !== undefined) return

    const turn = state.lastTurn
    if (typeof turn !== 'number' || state.lastEndReason !== 'completed') return
    if (readOption(configSource, 'includeSubagents', false) !== true && !isRootAgent(agent)) return
    if (state.goalTurn !== turn) return
    if (state.triggeredTurn === turn) return

    const goal = readGoal(agent)
    if (goal === undefined || goal === null) return
    if (goal.phase !== 'active' || goal.activation !== 'armed') return
    if (typeof goal.roundsStarted === 'number' && typeof goal.maxGoalRounds === 'number'
      && goal.roundsStarted >= goal.maxGoalRounds) return

    // 已有别的待领取输入时不插队：那种情况 driver 会自己退让，下一轮再判定。
    const nextTurn = agent.inbox?.nextTurn
    const nextStep = agent.inbox?.nextStep
    if (Array.isArray(nextTurn) && nextTurn.length > 0) return
    if (Array.isArray(nextStep) && nextStep.length > 0) return

    // 追问内容在这里实时读取：Plugins 页修改 prompt 后立即用于下一轮。
    const prompt = normalizePrompt(readOption(configSource, 'prompt', ''))
    const message = createPromptMessage(prompt)
    state.pendingMessage = message
    try {
      agent.followup(message)
      state.triggeredTurn = turn
    } catch (error) {
      state.pendingMessage = undefined
      warn(`could not queue goal critique for turn ${turn} of agent "${agent.id}": ${String(error)}`)
    }
  }

  /**
   * 单次判定 + 注入。所有前置条件不满足时静默返回，不做任何猜测。
   */
  async function drive(state) {
    const { agent } = state
    if (readOption(configSource, 'enabled', true) === false || stopping || state.stopping) return
    if (typeof ctx.fiber?.state === 'number' && ctx.fiber.state !== 2) return
    if (!isLive(agent)) return
    if (agent.status !== 'idle') return
    if (state.pendingMessage !== undefined) return

    const turn = state.lastTurn
    if (typeof turn !== 'number') return
    if (state.lastEndReason !== 'completed') return
    if (readOption(configSource, 'includeSubagents', false) !== true && !isRootAgent(agent)) return

    const nextTurn = agent.inbox?.nextTurn
    const nextStep = agent.inbox?.nextStep

    // 不变量 1 + 2：只认已观察到的人类 prompt，看不到来源就不触发。
    // goal 自动轮走 maybeInsertGoalCritique 的同步路径（见上），这里只处理人类轮。
    const claimedPrompt = state.claimedTurn === turn ? state.claimedPrompt : undefined
    const human = claimedPrompt !== undefined && isHumanMessage(claimedPrompt) && !isOwnMessage(claimedPrompt)
    if (!human) return

    if (state.triggeredTurn === turn) return
    // 不变量 3：绝不连续自动追问（防御来源判定未来被意外破坏）。
    if (state.triggeredTurn === turn - 1) return

    // 收件箱还有别的待领取输入时不插队：等队列清空后的下一个 idle 再判定。
    if (Array.isArray(nextTurn) && nextTurn.length > 0) return
    if (Array.isArray(nextStep) && nextStep.length > 0) return

    // 追问内容在这里实时读取：Plugins 页修改 prompt 后立即用于下一轮。
    const prompt = normalizePrompt(readOption(configSource, 'prompt', ''))
    const message = createPromptMessage(prompt)
    state.pendingMessage = message
    try {
      agent.followup(message)
      state.triggeredTurn = turn
    } catch (error) {
      state.pendingMessage = undefined
      warn(`could not queue "${prompt}" for agent "${agent.id}": ${String(error)}`)
    }
  }

  /** 把重复的 idle 通知合并进一个每 agent 串行的异步 drive。 */
  function requestDrive(state) {
    if (stopping || state.stopping) return
    state.requested = true
    if (state.run !== undefined) return

    let run
    try {
      run = ctx.agents.withoutInitiator(async () => {
        // 让发出 idle 的同步调用栈先跑完（turn/end 等事件先落地），再重新判定。
        await new Promise((resolve) => setTimeout(resolve, 0))
        while (state.requested && !state.stopping && !stopping) {
          state.requested = false
          try {
            await drive(state)
          } catch (error) {
            warn(`drive failed for agent "${state.agent.id}": ${String(error)}`)
          }
        }
      })
    } catch (error) {
      warn(`could not start driver for agent "${state.agent.id}": ${String(error)}`)
      state.requested = false
      return
    }

    state.run = run
    const retire = () => {
      state.run = undefined
      if (state.requested && !state.stopping && !stopping) requestDrive(state)
    }
    Promise.resolve(run).then(retire, (error) => {
      warn(`driver rejected for agent "${state.agent.id}": ${String(error)}`)
      retire()
    })
  }

  // ── 事件接线 ────────────────────────────────────────────────────────

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle') return
    const state = stateFor(agent)
    // goal 轮：必须在 goal-round-driver 异步续轮之前同步插入独立挑刺轮，否则会被它暂停。
    try {
      maybeInsertGoalCritique(state)
    } catch (error) {
      warn(`goal critique insertion failed for agent "${agent.id}": ${String(error)}`)
    }
    requestDrive(state)
  })

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    const state = stateFor(agent)
    // 每轮只记首条：首条是本轮 prompt，之后是 step 内的 steer / 注入。
    if (state.claimedTurn !== turn) {
      state.claimedTurn = turn
      state.claimedPrompt = message
    }
    // goal 轮的 prompt 可能不是首条被领取消息（上一轮注入的 next-step 内容会先被领取），
    // 所以按来源单独记 goal turn。
    if (isGoalMessage(message) && state.goalTurn !== turn) state.goalTurn = turn
    if (state.pendingMessage !== undefined && message?.id === state.pendingMessage.id) {
      state.pendingMessage = undefined
    }
  })

  ctx.on('agent/inbox/discarded', ({ agent, message }) => {
    const state = stateFor(agent)
    if (state.pendingMessage !== undefined && message?.id === state.pendingMessage.id) {
      state.pendingMessage = undefined
      // 追问在进入任何 turn 之前被取消：撤销触发记账，避免下一轮被连跳熔断误伤。
      state.triggeredTurn = undefined
    }
  })

  ctx.on('goal/changed', ({ agent, change }) => {
    const operation = change?.operation
    if (operation !== 'pause' && operation !== 'complete' && operation !== 'block' && operation !== 'clear') return
    const state = states.get(agent)
    const pending = state?.pendingMessage
    if (state === undefined || pending === undefined) return
    // goal 不再自动续轮：撤回尚未被领取的挑刺轮，避免它漂移到之后的人类轮。
    state.pendingMessage = undefined
    try {
      state.agent.inbox?.remove?.(pending.id)
    } catch {
      /* agent 可能已销毁 */
    }
  })

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    let agent
    try {
      agent = ctx.agents.get(session.id)
    } catch {
      return
    }
    if (agent === undefined || agent.session !== session) return
    const state = stateFor(agent)
    state.lastTurn = event.data?.turn
    state.lastEndReason = event.data?.reason?.kind
  })

  return () => {
    stopping = true
    for (const state of states.values()) {
      state.stopping = true
      const pending = state.pendingMessage
      state.pendingMessage = undefined
      if (pending === undefined) continue
      try {
        state.agent.inbox?.remove?.(pending.id)
      } catch {
        /* agent 可能已销毁 */
      }
    }
    states.clear()
  }
}
