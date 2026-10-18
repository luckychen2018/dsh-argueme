/**
 * dsh-argueme — 浏览器半边（client half）
 *
 * 在 Web 侧边栏 Plugins 页、本 bundle 的页面上注册一张配置卡片，让用户直接
 * 修改「自动追问开关」和「追问内容」。卡片绑定 Host 侧的 settings 配置表单
 * （configForms 提供 snapshot + set），namespace 是 loader row id `dsh-argueme`；
 * 而 Plugins 页的 keyed slot 用 bundle 包名 `dsh-argueme` 作为 key。
 *
 * 这是 host 侧 index.js 里 Config（volatile 字段）的配套 UI；改动的值会写回
 * profile 的 Cordis patch，并立即用于下一轮追问，无需重启。
 */
window.__ModuleLoader__.load({
  id: 'dsh-argueme',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'dsh-argueme'
    const SLOT_KEY = 'dsh-argueme'
    const ROW_KEY = 'dsh-argueme#dsh-argueme'

    // 与 Host 侧 index.js 的 BUILT_IN_PROMPT 保持一致；只用于 textarea 背景字。
    const BUILT_IN_PROMPT = `【第一性原理复核 · 只针对你上一轮回答】
不要客套，不要复述。按顺序挑刺：
1) 目标还原：本次请求真正要解决的问题是什么？你的回答命中的是根问题，还是字面问题？
2) 拆到基本事实：列出结论依赖的原始事实、硬约束和已验证证据；把“惯例、常识、大家都这么做、感觉合理”逐条标为假设，并判断哪些其实未经证实。
3) 从基本事实重新推导：去掉所有默认假设后，最直接的解是什么？你的方案是否因此更简单、更正确、代价更低？有差异就说明原因与代价。
4) 找漏洞并按严重度排序：事实错误 > 逻辑跳跃 > 隐藏假设 > 边界条件/反例遗漏 > 未验证结论 > 与目标偏差。每条给出证据或反例，禁止臆测。
5) 给出可直接采纳的修正：最小必要改动（结论/步骤/代码），不要泛泛而谈。
6) 最后一行输出：\`结论：可接受\`，或 \`结论：需要修正：<最小必须修改项>\`。若确认无问题，说明依据哪些证据判断它成立；不要为凑数编问题。`

    const DICT_ZH = {
      title: '每轮自审',
      description: '每轮由你发起的对话正常结束后，自动再发一条追问，让助手复核自己上一轮的回答。',
      enabled: '自动追问',
      enabledDesc: '关闭后不再自动发送；也可以直接在插件行上停用整个插件。',
      prompt: '追问内容',
      promptHint: '留空 = 使用内置「第一性原理复核」文案（灰色背景字）；填写内容则覆盖它。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      conflict: '保存失败：配置已变化，请重试',
      readOnly: '当前配置不可写（可能来自更高优先级的 patch 层）。',
      promptPlaceholder: BUILT_IN_PROMPT,
      summaryOn: '自动追问开启中',
      summaryOff: '自动追问已关闭',
      notReady: '配置表单尚未就绪：插件 Host 已加载，正在等待设置服务提供该命名空间的表单。',
    }
    const DICT_EN = {
      title: 'Round Self-Review',
      description: 'After each completed round you started, one automatic follow-up asks the assistant to critique its previous answer.',
      enabled: 'Auto follow-up',
      enabledDesc: 'When off, nothing is sent automatically. You can also disable the whole plugin row.',
      prompt: 'Follow-up prompt',
      promptHint: 'Leave empty to use the built-in 「第一性原理复核」 prompt (shown as placeholder); typing overrides it.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      conflict: 'Save failed: the configuration changed, please retry',
      readOnly: 'This configuration is read-only (overridden by a higher-priority patch layer).',
      promptPlaceholder: BUILT_IN_PROMPT,
      summaryOn: 'Auto follow-up is on',
      summaryOff: 'Auto follow-up is off',
      notReady: 'Config form is not available yet: the plugin host is running, waiting for the settings service to serve this namespace.',
    }

    const T = {
      section: {
        paddingTop: '12px',
        marginTop: '4px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      head: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      },
      title: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary)',
      },
      description: {
        margin: '4px 0 10px',
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary)',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        padding: '10px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      label: {
        fontSize: '13px',
        color: 'var(--dsw-alias-label-primary)',
      },
      hint: {
        marginTop: '3px',
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary)',
      },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '160px',
        marginTop: '6px',
        padding: '9px 12px',
        fontSize: '13px',
        lineHeight: 1.65,
        fontFamily: 'inherit',
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-layer-3)',
        border: '0.5px solid var(--dsw-alias-border-l4)',
        borderRadius: '8px',
        outline: 'none',
        resize: 'vertical',
      },
      editorFooter: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        marginTop: '8px',
      },
      // 与宿主原生主按钮一致：底色 = label-primary，文字 = bg-layer-3（两套主题都保证对比度）。
      button: {
        flex: 'none',
        appearance: 'none',
        font: 'inherit',
        padding: '5px 14px',
        fontSize: '13px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-bg-layer-3)',
        background: 'var(--dsw-alias-label-primary)',
        border: '1px solid transparent',
        borderRadius: '8px',
        cursor: 'pointer',
      },
      buttonDisabled: {
        opacity: 0.4,
        cursor: 'default',
      },
      notice: {
        flex: 'none',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      noticeError: {
        flex: 'none',
        fontSize: '12px',
        color: 'var(--dsw-alias-state-error-primary)',
      },
      readOnly: {
        margin: '6px 0 0',
        fontSize: '12px',
        color: 'var(--dsw-alias-state-warn-primary)',
      },
    }

    /** 绑定 settings 配置表单的快照 + 写入口（形态与 dsh-context 的设置卡片一致）。 */
    function createBoundSettings() {
      let form
      let state = { status: 'loading', value: {}, writable: false }
      const listeners = new Set()
      const publish = (next) => {
        state = next
        for (const listener of listeners) listener()
      }
      const sync = () => {
        if (form === undefined) return
        let snapshot
        try {
          snapshot = form.getSnapshot()
        } catch {
          return
        }
        const value = snapshot !== null && typeof snapshot === 'object'
          && snapshot.value !== null && typeof snapshot.value === 'object'
          ? snapshot.value
          : {}
        publish({
          status: typeof snapshot?.status === 'string' ? snapshot.status : 'ready',
          value,
          writable: snapshot?.writable === true,
        })
      }
      return {
        store: {
          subscribe(listener) {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
          getSnapshot: () => state,
        },
        attach(bound) {
          form = bound
          sync()
          const unsubscribe = typeof bound.subscribe === 'function' ? bound.subscribe(sync) : () => {}
          return () => {
            unsubscribe()
            form = undefined
          }
        },
        set(field, value) {
          if (form === undefined) return Promise.resolve()
          publish({ ...state, value: { ...state.value, [field]: value } })
          return Promise.resolve(form.set(field, value)).catch((error) => {
            sync()
            throw error
          })
        },
      }
    }

    /** Plugins 页上的配置卡片。 */
    function makeCard(t) {
      return function ArguemeCard(props) {
        const snapshot = typeof props.useArguemeSettings === 'function'
          ? props.useArguemeSettings((value) => value)
          : undefined
        const [draft, setDraft] = React.useState(null)
        const [notice, setNotice] = React.useState('')
        const [noticeError, setNoticeError] = React.useState(false)

        React.useEffect(() => {
          if (notice === '') return undefined
          const timer = setTimeout(() => setNotice(''), 2600)
          return () => clearTimeout(timer)
        }, [notice])

        if (snapshot === undefined || snapshot.status === 'unavailable') {
          return h('p', { style: T.hint, role: 'status' }, t('notReady'))
        }
        const value = snapshot.value !== null && typeof snapshot.value === 'object' ? snapshot.value : {}
        const writable = snapshot.writable === true
        const enabled = value.enabled !== false
        const promptText = draft !== null
          ? draft
          : (typeof value.prompt === 'string' ? value.prompt : '')

        // bundle 页 / 行页的摘要位只给一行状态文本。
        if (props.view === 'summary') {
          return h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
            enabled ? t('summaryOn') : t('summaryOff'))
        }

        const write = (field, next, doneText) => {
          setNotice(t('saving'))
          setNoticeError(false)
          Promise.resolve(props.set(field, next)).then(() => {
            setNotice(doneText)
            setNoticeError(false)
          }, () => {
            setNotice(t('conflict'))
            setNoticeError(true)
          })
        }
        const commitPrompt = () => {
          if (draft === null) return
          const next = draft
          setDraft(null)
          write('prompt', next, t('saved'))
        }

        return h('section', { style: T.section },
          h('div', { style: T.head },
            h('h3', { style: T.title }, t('title')),
            notice !== '' ? h('span', { style: noticeError ? T.noticeError : T.notice, role: 'status' }, notice) : null,
          ),
          h('p', { style: T.description }, t('description')),
          h('style', { key: 'argueme-prompt-style' },
            '.dsh-argueme-prompt::placeholder{color:var(--dsw-alias-label-dimmed);opacity:1;}'
            + '.dsh-argueme-prompt:focus{border-color:var(--dsw-alias-brand-primary);outline:none;}'
            + '.dsh-argueme-save:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}'
            + '.dsh-argueme-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}'),
          !writable && snapshot.status === 'ready' ? h('p', { style: T.readOnly, role: 'status' }, t('readOnly')) : null,

          h('div', { style: T.row },
            h('div', {},
              h('div', { style: T.label }, t('enabled')),
              h('div', { style: T.hint }, t('enabledDesc')),
            ),
            h('input', {
              type: 'checkbox',
              role: 'switch',
              'aria-checked': enabled,
              checked: enabled,
              disabled: !writable,
              onChange: (event) => write('enabled', event.target.checked, t('saved')),
            }),
          ),

          h('div', { style: { ...T.row, alignItems: 'stretch', flexDirection: 'column', gap: '0' } },
            h('div', { style: T.label }, t('prompt')),
            h('textarea', {
              className: 'dsh-argueme-prompt',
              rows: 7,
              value: promptText,
              placeholder: t('promptPlaceholder'),
              disabled: !writable,
              spellCheck: false,
              style: T.textarea,
              onChange: (event) => setDraft(event.target.value),
              onBlur: () => commitPrompt(),
            }),
            h('div', { style: T.editorFooter },
              h('div', { style: T.hint }, t('promptHint')),
              h('button', {
                className: 'dsh-argueme-save',
                type: 'button',
                disabled: !writable,
                style: writable ? T.button : { ...T.button, ...T.buttonDisabled },
                onClick: () => commitPrompt(),
              }, t('save')),
            ),
          ),
        )
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'dsh-argueme: dictionaries')
      const t = ctx.locale.bind(NS)
      const settings = createBoundSettings()
      const Card = makeCard(t)
      const cardFace = () => ({
        hooks: { arguemeSettings: settings.store },
        set: (field, value) => settings.set(field, value),
      })

      // 设置表单的命名空间 = loader row id。兜底再试一次 include: 前缀形式，
      // 避免不同版本对嵌套行命名空间的包装差异导致永远等不到表单。
      const NAMESPACE_CANDIDATES = [NS, `include:${NS}`]

      ctx.inject(['configForms'], (c) => {
        const forms = c.configForms
        if (forms === undefined || typeof forms.get !== 'function') return

        // 绑定「真正被 Host 服务」的那个命名空间。
        if (typeof forms.whileServed === 'function') {
          c.effect(() => forms.whileServed(NAMESPACE_CANDIDATES, (served) => {
            const isServed = (name) => {
              if (served instanceof Set) return served.has(name)
              if (Array.isArray(served)) return served.includes(name)
              if (served !== null && typeof served === 'object') return served[name] === true
              return true
            }
            let chosen
            let chosenReady = false
            for (const candidate of NAMESPACE_CANDIDATES) {
              if (!isServed(candidate)) continue
              let form
              try {
                form = forms.get(candidate)
              } catch {
                form = undefined
              }
              if (form === undefined || form === null) continue
              let ready = false
              try {
                ready = form.getSnapshot()?.status === 'ready'
              } catch {
                ready = false
              }
              if (chosen === undefined || (ready && !chosenReady)) {
                chosen = form
                chosenReady = ready
              }
              if (ready) break
            }
            if (chosen === undefined) return undefined
            return settings.attach(chosen)
          }), 'dsh-argueme: config form binding')
        } else {
          c.effect(() => settings.attach(forms.get(NS)), 'dsh-argueme: config form binding')
        }

        // 卡片注册不依赖「表单已服务」：即使表单还没到也先把卡片显示出来，
        // 这样「client 模块没加载」和「表单没 serving」在界面上可以一眼区分。
        c.effect(() => {
          const disposeBundle = c.slots.inject('plugins.bundle.config', () => {
            return c.slots.register({
              name: 'plugins.bundle.config',
              key: SLOT_KEY,
              locale: NS,
              inject: cardFace,
            }, Card)
          })
          const disposeRow = c.slots.inject('plugins.row.config', () => {
            return c.slots.register({
              name: 'plugins.row.config',
              key: ROW_KEY,
              locale: NS,
              inject: cardFace,
            }, Card)
          })
          return () => {
            disposeBundle()
            disposeRow()
          }
        }, 'dsh-argueme: plugins-page config cards')
      })
    }

    return { name: 'dsh-argueme', inject: ['slots', 'locale'], apply }
  },
})
