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

function createHarness({ rootsThrows = false } = {}) {
  const handlers = new Map()
  const agents = new Map()
  const roots = new Set()
  const warnings = []

  const ctx = {
    logger: { warn: (message) => warnings.push(String(message)) },
    on(event, fn) {
      const list = handlers.get(event) ?? []
      list.push(fn)
      handlers.set(event, list)
      return () => {}
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
        const index = this.nextTurn.findIndex((message) => message.id === messageId)
        if (index < 0) return false
        this.nextTurn.splice(index, 1)
        return true
      },
    }
    const agent = {
      id,
      status: 'idle',
      session: { id },
      inbox,
      followups: [],
      followup(message) {
        this.followups.push(message)
        this.inbox.nextTurn.push(message)
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

  return { ctx, agents, createAgent, claim, startTurn, endTurn, emit, warnings }
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
  assert.equal(resolved.includeSubagents, false)
  // settings 表单只认 meta.volatile 字段：enabled/prompt 必须声明，includeSubagents 不声明。
  const json = Config.toJSON()
  const root = json.refs[json.uid]
  assert.equal(root.type, 'object')
  assert.equal(json.refs[root.dict.enabled].meta.volatile, true)
  assert.equal(json.refs[root.dict.prompt].meta.volatile, true)
  assert.equal(json.refs[root.dict.prompt].meta.default, '')
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
