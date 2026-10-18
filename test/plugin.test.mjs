/**
 * 离线单元测试：用假的 ctx / agent / 事件总线驱动 index.js 的 apply()，
 * 覆盖正常路径与四条防死循环不变量。
 *
 * 运行：node test/plugin.test.mjs
 */
import assert from 'node:assert/strict'
import { apply, Config } from '../index.js'

const HUMAN = { kind: 'user' }
const OWN = { kind: 'plugin:dsh-argueme' }
const GOAL = { kind: 'goal' }

function goalView(overrides = {}) {
  return {
    id: 'goal-1',
    revision: 1,
    objective: 'test objective',
    phase: 'active',
    maxGoalRounds: 5,
    roundsStarted: 1,
    activation: 'armed',
    ...overrides,
  }
}

/**
 * 简化版 goal-round-driver：在 idle 的异步阶段续一轮 goal；看到外来 next-turn 消息
 * （competingQueued）时退让。用于验证我们的同步插入能赢下这个竞争。
 */
function attachFakeGoalDriver(h, agent) {
  const state = { competing: false, round: 0 }
  h.ctx.on('agent/status', ({ agent: target, status }) => {
    if (target !== agent || status !== 'idle') return
    state.competing = false
    Promise.resolve().then(() => {
      if (state.competing || agent.status !== 'idle') return
      const goal = h.goals.get(agent)
      if (goal === undefined || goal.phase !== 'active' || goal.activation !== 'armed') return
      state.round += 1
      agent.inbox.nextTurn.push(message(`goal-round-${state.round}`, GOAL, '<goal_round>'))
    })
  })
  h.ctx.on('agent/inbox/inserted', ({ agent: target, message: inserted }) => {
    if (target !== agent) return
    if (inserted.source?.kind === 'goal') return
    state.competing = true
  })
  return state
}

function createHarness({ rootsThrows = false } = {}) {
  const handlers = new Map()
  const agents = new Map()
  const roots = new Set()
  const goals = new Map()
  const warnings = []

  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    on(event, fn) {
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
      return () => {}
    },
    get(name) {
      if (name !== 'goals') return undefined
      return { get: (agent) => goals.get(agent) }
    },
    agents: {
      list: () => [...agents.values()],
      get: (id) => agents.get(id),
      roots: () => {
        if (rootsThrows) throw new Error('roots unavailable')
        return [...roots]
      },
      withoutInitiator: (operation) => operation(),
    },
  }

  const emit = (event, ...args) => {
    for (const fn of handlers.get(event) ?? []) fn(...args)
  }

  function createAgent(id, { root = true } = {}) {
    const inbox = {
      nextTurn: [],
      nextStep: [],
      remove(messageId) {
        for (const list of [this.nextTurn, this.nextStep]) {
          const index = list.findIndex((message) => message.id === messageId)
          if (index < 0) continue
          list.splice(index, 1)
          return true
        }
        return false
      },
    }
    const agent = {
      id,
      status: 'idle',
      session: { id },
      inbox,
      followups: [],
      injects: [],
      followup(message) {
        this.followups.push(message)
        this.inbox.nextTurn.push(message)
        emit('agent/inbox/inserted', { agent: this, message })
      },
      inject(message) {
        this.injects.push(message)
        this.inbox.nextStep.push(message)
        emit('agent/inbox/inserted', { agent: this, message })
      },
    }
    agents.set(id, agent)
    if (root) roots.add(agent)
    return agent
  }

  function claim(agent, turn, message) {
    // 模拟真实 loop 的 claim：把消息从待领取列表里取走。
    for (const list of [agent.inbox.nextTurn, agent.inbox.nextStep]) {
      const index = list.findIndex((candidate) => candidate.id === message.id)
      if (index >= 0) {
        list.splice(index, 1)
        break
      }
    }
    emit('agent/inbox/claimed', { agent, message, turn })
  }

  function startTurn(agent) {
    agent.status = 'running'
    emit('agent/status', { agent, status: 'running' })
  }

  function endTurn(agent, turn, reason = 'completed') {
    emit('session/event', agent.session, { type: 'turn/end', data: { turn, reason: { kind: reason } } })
    agent.status = 'idle'
    emit('agent/status', { agent, status: 'idle' })
  }

  return { ctx, agents, createAgent, claim, startTurn, endTurn, emit, warnings, goals, setGoal: (agent, goal) => goals.set(agent, goal) }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

function message(id, source, text = id) {
  return { id, role: 'user', content: [{ type: 'text', text }], source }
}

const tests = []
function test(name, fn) {
  tests.push({ name, fn })
}

test('人类轮次正常结束后恰好自动追问一次，内容与来源正确', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-human')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()

  assert.equal(agent.followups.length, 1)
  const injected = agent.followups[0]
  assert.equal(injected.role, 'user')
  assert.ok(injected.content[0].text.startsWith('【第一性原理复核'), 'falls back to the built-in prompt')
  assert.deepEqual(injected.source, { kind: 'plugin:dsh-argueme' })
  dispose()
})

test('插件自己的追问轮次结束后不再触发（结构性无循环）', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-own')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1)

  h.claim(agent, 2, agent.followups[0])
  h.startTurn(agent)
  h.endTurn(agent, 2, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1, 'own turn must never re-trigger')
  dispose()
})

test('未观察到本轮 prompt 来源时不触发（绝不猜测）', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-no-claim')

  // 没有 claim 事件，只有 turn 结束：模拟插件在轮次中途装载后那一轮收尾
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 0)
  dispose()
})

test('连跳熔断：上一轮刚自动追问过，下一 turn 不连续触发', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-fuse')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1)

  // 极端情形：turn 2 的来源仍被判定为人类，但它是上一轮追问的直接后继 → 熔断
  h.startTurn(agent)
  h.claim(agent, 2, message('m2', HUMAN))
  h.endTurn(agent, 2, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1, 'chain fuse must block the direct successor turn')
  dispose()
})

test('aborted / error / blocked / max-tokens 的轮次不触发', async () => {
  for (const reason of ['aborted', 'error', 'blocked', 'max-tokens', 'interrupted']) {
    const h = createHarness()
    const dispose = apply(h.ctx, undefined)
    const agent = h.createAgent(`session-${reason}`)

    h.startTurn(agent)
    h.claim(agent, 1, message('m1', HUMAN))
    h.endTurn(agent, 1, reason)
    await tick()
    assert.equal(agent.followups.length, 0, `${reason} must not trigger`)
    dispose()
  }
})

test('非人类来源的 prompt（goal / 插件 / 团队消息）不触发', async () => {
  for (const source of [
    { kind: 'goal', goalId: 'g', revision: 1, round: 2 },
    { kind: 'plugin:other', form: 'notice' },
    { kind: 'team-message', senderName: 'x' },
    { kind: 'agent-message', senderSessionId: 'y' },
  ]) {
    const h = createHarness()
    const dispose = apply(h.ctx, undefined)
    const agent = h.createAgent(`session-src-${String(source.kind).replace(/[^a-z]/g, '')}`)

    h.startTurn(agent)
    h.claim(agent, 1, message('m1', source))
    h.endTurn(agent, 1, 'completed')
    await tick()
    assert.equal(agent.followups.length, 0, `${source.kind} must not trigger`)
    dispose()
  }
})

test('默认不触发非 root 会话；includeSubagents=true 时生效', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const child = h.createAgent('session-child', { root: false })

  h.startTurn(child)
  h.claim(child, 1, message('m1', HUMAN))
  h.endTurn(child, 1, 'completed')
  await tick()
  assert.equal(child.followups.length, 0, 'child must not trigger by default')
  dispose()

  const h2 = createHarness()
  const dispose2 = apply(h2.ctx, { includeSubagents: true })
  const child2 = h2.createAgent('session-child-2', { root: false })
  h2.startTurn(child2)
  h2.claim(child2, 1, message('m1', HUMAN))
  h2.endTurn(child2, 1, 'completed')
  await tick()
  assert.equal(child2.followups.length, 1)
  dispose2()
})

test('roots() 不可用时按非 root 处理（fail-safe，不误伤子会话）', async () => {
  const h = createHarness({ rootsThrows: true })
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-roots-throw')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 0, 'unknown root status must fail closed')
  dispose()
})

test('收件箱还有待领取输入时不插队', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-queued')

  agent.inbox.nextTurn.push(message('pending', HUMAN))
  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 0)
  dispose()
})

test('同一 turn 的重复 idle 只触发一次', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-dup')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.emit('session/event', agent.session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  agent.status = 'idle'
  for (let index = 0; index < 4; index += 1) h.emit('agent/status', { agent, status: 'idle' })
  await tick()
  assert.equal(agent.followups.length, 1)
  dispose()
})

test('卸载时撤回尚未被领取的追问消息', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-unload')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1)
  assert.equal(agent.inbox.nextTurn.length, 1)

  dispose()
  assert.equal(agent.inbox.nextTurn.length, 0)
})

test('config：prompt 覆盖、enabled=false 关闭', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, { enabled: true, prompt: '复审一下' })
  const agent = h.createAgent('session-prompt')
  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups[0].content[0].text, '复审一下')
  dispose()

  const h2 = createHarness()
  const dispose2 = apply(h2.ctx, { enabled: false })
  const agent2 = h2.createAgent('session-off')
  h2.startTurn(agent2)
  h2.claim(agent2, 1, message('m1', HUMAN))
  h2.endTurn(agent2, 1, 'completed')
  await tick()
  assert.equal(agent2.followups.length, 0)
  dispose2()
})

test('追问在进入任何 turn 前被取消：撤销触发记账，下一轮人类轮次照常触发', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-discarded')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1)

  // 模拟用户取消：队列里的追问被 discard（没有进入任何 turn）
  const pending = agent.followups[0]
  agent.inbox.nextTurn.length = 0
  h.emit('agent/inbox/discarded', { agent, message: pending })

  // 下一轮人类轮次不应被连跳熔断误伤
  h.startTurn(agent)
  h.claim(agent, 2, message('m2', HUMAN))
  h.endTurn(agent, 2, 'completed')
  await tick()
  assert.equal(agent.followups.length, 2)
  dispose()
})

test('Config 导出：schemastery schema、默认值与 volatile 声明', async () => {
  assert.equal(typeof Config, 'function')
  assert.equal(typeof Config.toJSON, 'function')
  const resolved = Config({})
  assert.equal(resolved.enabled.get(), true)
  assert.equal(resolved.prompt.get(), '')
  assert.equal(resolved.includeGoalRounds.get(), false)
  assert.equal(resolved.includeSubagents, false)
  // settings 表单只认 meta.volatile 字段：enabled/prompt/includeGoalRounds 必须声明，
  // includeSubagents 不声明。
  const json = Config.toJSON()
  const root = json.refs[json.uid]
  assert.equal(root.type, 'object')
  assert.equal(json.refs[root.dict.enabled].meta.volatile, true)
  assert.equal(json.refs[root.dict.prompt].meta.volatile, true)
  assert.equal(json.refs[root.dict.prompt].meta.default, '')
  assert.equal(json.refs[root.dict.includeGoalRounds].meta.volatile, true)
  assert.equal(json.refs[root.dict.includeGoalRounds].meta.default, false)
  assert.equal(json.refs[root.dict.includeSubagents].meta.volatile, undefined)
})

test('volatile 配置实时读取：prompt / enabled 每次都取 .get()', async () => {
  const h = createHarness()
  let enabled = true
  const dispose = apply(h.ctx, {
    enabled: { get: () => enabled },
    prompt: { get: () => '实时追问内容' },
    includeSubagents: false,
  })
  const agent = h.createAgent('session-volatile')

  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1)
  assert.equal(agent.followups[0].content[0].text, '实时追问内容')

  // 关闭后：插件自己的追问轮不触发，下一轮人类轮也不触发
  h.claim(agent, 2, agent.followups[0])
  h.startTurn(agent)
  h.endTurn(agent, 2, 'completed')
  enabled = false
  h.startTurn(agent)
  h.claim(agent, 3, message('m3', HUMAN))
  h.endTurn(agent, 3, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1, 'enabled=false must take effect live')

  // 重新打开后立即恢复
  enabled = true
  h.startTurn(agent)
  h.claim(agent, 4, message('m4', HUMAN))
  h.endTurn(agent, 4, 'completed')
  await tick()
  assert.equal(agent.followups.length, 2)
  dispose()
})

test('空白 prompt 回落到内置「第一性原理复核」文案', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, { prompt: '   ' })
  const agent = h.createAgent('session-blank-prompt')
  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.ok(agent.followups[0].content[0].text.startsWith('【第一性原理复核'))
  dispose()
})

test('prompt 为空字符串（面板留空）同样使用内置文案', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, { prompt: '' })
  const agent = h.createAgent('session-empty-prompt')
  h.startTurn(agent)
  h.claim(agent, 1, message('m1', HUMAN))
  h.endTurn(agent, 1, 'completed')
  await tick()
  assert.ok(agent.followups[0].content[0].text.startsWith('【第一性原理复核'))
  dispose()
})

test('goal 轮默认不触发（includeGoalRounds 默认关闭）', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, undefined)
  const agent = h.createAgent('session-goal-default')
  h.setGoal(agent, goalView())

  h.startTurn(agent)
  h.claim(agent, 1, message('g1', GOAL))
  h.endTurn(agent, 1, 'completed')
  await tick()

  assert.equal(agent.followups.length, 0)
  assert.equal(agent.injects.length, 0)
  dispose()
})

test('开启后每个 goal 轮结束都同步插入独立挑刺轮，下一轮 goal 继续', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, { includeGoalRounds: true })
  const agent = h.createAgent('session-goal-each')
  h.setGoal(agent, goalView())

  h.startTurn(agent)
  h.claim(agent, 1, message('g1', GOAL))
  h.endTurn(agent, 1, 'completed')
  // 同步插入：不需要等待任何 tick。
  assert.equal(agent.followups.length, 1, 'critique turn is queued synchronously at goal round end')
  assert.deepEqual(agent.followups[0].source, OWN)
  assert.ok(agent.followups[0].content[0].text.startsWith('【第一性原理复核'))
  assert.equal(agent.injects.length, 0)
  await tick()
  assert.equal(agent.followups.length, 1, 'async driver must not double-queue')
  assert.equal(agent.inbox.nextTurn.length, 1)

  // 挑刺轮本身结束：不触发新追问。
  h.startTurn(agent)
  h.claim(agent, 2, agent.followups[0])
  h.endTurn(agent, 2, 'completed')
  await tick()
  assert.equal(agent.followups.length, 1)

  // 下一轮 goal：再插一次。
  h.setGoal(agent, goalView({ roundsStarted: 2 }))
  h.startTurn(agent)
  h.claim(agent, 3, message('g2', GOAL))
  h.endTurn(agent, 3, 'completed')
  assert.equal(agent.followups.length, 2, 'each goal round gets its own critique turn')
  dispose()
})

test('goal 非 active/armed 或回合预算用尽时不插入挑刺轮', async () => {
  const scenarios = [
    goalView({ phase: 'paused' }),
    goalView({ activation: 'disarmed' }),
    goalView({ roundsStarted: 5, maxGoalRounds: 5 }),
  ]
  for (const goal of scenarios) {
    const h = createHarness()
    const dispose = apply(h.ctx, { includeGoalRounds: true })
    const agent = h.createAgent('session-goal-inactive')
    h.setGoal(agent, goal)

    h.startTurn(agent)
    h.claim(agent, 1, message('g1', GOAL))
    h.endTurn(agent, 1, 'completed')
    assert.equal(agent.followups.length, 0, `no critique turn for ${JSON.stringify(goal)}`)
    dispose()
  }
})

test('goal 结束（pause/complete/block/clear）时撤回未领取的挑刺轮', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, { includeGoalRounds: true })
  const agent = h.createAgent('session-goal-retract')
  h.setGoal(agent, goalView())

  h.startTurn(agent)
  h.claim(agent, 1, message('g1', GOAL))
  h.endTurn(agent, 1, 'completed')
  assert.equal(agent.inbox.nextTurn.length, 1)

  h.emit('goal/changed', { agent, change: { operation: 'pause', goal: goalView({ phase: 'paused', activation: 'disarmed' }) } })
  assert.equal(agent.inbox.nextTurn.length, 0, 'pending critique turn is retracted when the goal stops')
  dispose()
})

test('不插队：goal 轮结束时已有待领取输入则跳过', async () => {
  const h = createHarness()
  const dispose = apply(h.ctx, { includeGoalRounds: true })
  const agent = h.createAgent('session-goal-busy')
  h.setGoal(agent, goalView())

  h.startTurn(agent)
  h.claim(agent, 1, message('g1', GOAL))
  agent.inbox.nextTurn.push(message('pending-human', HUMAN))
  h.endTurn(agent, 1, 'completed')
  assert.equal(agent.followups.length, 0)
  dispose()
})

test('与 goal-round-driver 的异步续轮竞争：挑刺轮先占队列，goal 随后继续', async () => {
  const h = createHarness()
  const agent = h.createAgent('session-goal-race')
  // 先注册假 driver，模拟真实场景中 goal-round-driver 的监听顺序（早于本插件）。
  const driver = attachFakeGoalDriver(h, agent)
  const dispose = apply(h.ctx, { includeGoalRounds: true })
  h.setGoal(agent, goalView())

  h.startTurn(agent)
  h.claim(agent, 1, message('g1', GOAL))
  h.endTurn(agent, 1, 'completed')
  assert.equal(agent.followups.length, 1)
  await tick()
  assert.deepEqual(
    agent.inbox.nextTurn.map((queued) => queued.source.kind),
    ['plugin:dsh-argueme'],
    'the driver must back off; only the critique turn is queued',
  )
  assert.equal(driver.competing, true)

  // 挑刺轮跑完，goal 循环恢复。
  h.startTurn(agent)
  h.claim(agent, 2, agent.followups[0])
  h.endTurn(agent, 2, 'completed')
  await tick()
  assert.ok(agent.inbox.nextTurn.some((queued) => queued.source.kind === 'goal'),
    'a goal round continues after the critique turn')
  dispose()
})

let failed = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}
if (failed > 0) {
  console.error(`\n${failed}/${tests.length} test(s) failed`)
  process.exitCode = 1
} else {
  console.log(`\nall ${tests.length} tests passed`)
}
