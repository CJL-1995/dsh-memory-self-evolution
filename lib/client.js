window.__ModuleLoader__.load({
  id: "dsh-memory-self-evolution",
  factory: (require) => {
    const React = require("react")

    const CSS = '.dm-root{padding:16px 20px;max-width:1400px;margin:0 auto;box-sizing:border-box}.dm-header{margin-bottom:12px;text-align:center}.dm-title{font-size:18px;font-weight:650;color:var(--dsw-alias-label-primary)}.dm-subtitle{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px}.dm-toolbar{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:center;justify-content:center}.dm-btn{padding:6px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:13px;line-height:1.4}.dm-btn:disabled{opacity:.45;cursor:default}.dm-btn-primary{background:#2563eb;border-color:#2563eb;color:#ffffff}.dm-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.dm-select{padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;max-width:240px}.dm-input{padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;width:160px}.dm-addtag{display:inline-flex;gap:6px;align-items:center}.dm-error{color:var(--dsw-alias-state-error-primary);font-size:13px;margin-bottom:12px}.dm-notice{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--dsw-alias-label-secondary)}.dm-notice-item{margin-top:6px;color:var(--dsw-alias-label-primary)}.dm-empty{color:var(--dsw-alias-label-secondary);font-size:12px;padding:20px 0;text-align:center}.dm-cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;align-items:start}.dm-col{min-width:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;max-height:calc(100vh - 320px);overflow-y:auto}.dm-col-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between}.dm-col-count{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary)}.dm-list{display:flex;flex-direction:column;gap:8px}.dm-row{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}.dm-row-checked{border-color:#2563eb;background:var(--dsw-alias-bg-layer-2)}.dm-check{margin-top:4px;width:15px;height:15px;cursor:pointer;accent-color:#2563eb;flex:none}.dm-body{flex:1 1 auto;min-width:0}.dm-text{font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5;word-break:break-word}.dm-evidence{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px}.dm-tag{display:inline-block;margin-top:6px;font-size:11px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1)}.dm-confidence{flex:none;font-size:12px;font-weight:650;font-variant-numeric:tabular-nums;padding-top:2px}.dm-mem{font-size:13px;color:var(--dsw-alias-label-primary);padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l1);line-height:1.5;word-break:break-word}.dm-mem-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px}.dm-mem-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.dm-mem-text{flex:1 1 auto;min-width:0;line-height:1.5;word-break:break-word}.dm-btn-small{padding:1px 10px;font-size:12px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;line-height:1.6;white-space:nowrap;flex:none}.dm-btn-small:disabled{opacity:.45;cursor:default}.dm-btn-small-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}.dm-read{margin-bottom:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.dm-read-title{color:var(--dsw-alias-label-primary);font-weight:500}.dm-filter-row{display:flex;align-items:center;gap:6px;margin-bottom:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}.dm-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:6000}.dm-modal{background:#ffffff;border-radius:12px;padding:20px;width:380px;max-width:88vw;box-shadow:0 12px 40px rgba(0,0,0,.35)}.dm-modal-title{font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:10px}.dm-modal-text{font-size:13px;color:#555;margin-bottom:16px;word-break:break-word;line-height:1.5}.dm-modal-actions{display:flex;gap:8px;justify-content:flex-end}.dm-picker{position:absolute;bottom:calc(100% + 4px);left:0;width:340px;max-height:320px;overflow:auto;background:#ffffff;border:1px solid #c8c8c8;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.28);padding:6px;z-index:5000;font-family:system-ui,sans-serif}.dm-picker-title{font-size:12px;color:#666;padding:6px 10px}.dm-picker-item{display:flex;justify-content:space-between;align-items:center;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:14px;color:#1a1a1a}.dm-picker-item:hover{background:#f0f0f0}.dm-picker-count{font-size:12px;color:#999}.dm-picker-empty{font-size:13px;color:#999;padding:12px 10px}'

    async function apiGet(path) {
      const res = await fetch(path)
      return await res.json()
    }
    async function apiPost(path, body) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      })
      return await res.json()
    }

    function MemoryPicker(props) {
      const useInput = props.useInput
      const inputActions = props.inputActions
      const sessionId = props.sessionId
      const draft = useInput ? useInput((s) => (s && typeof s.draft === 'string' ? s.draft : '')) : ''
      const [tags, setTags] = React.useState([])

      const trimmed = String(draft || '').trim()
      const show = trimmed.startsWith('--') && trimmed.length <= 40

      React.useEffect(() => {
        if (show && tags.length === 0) {
          apiGet('/api/memory/state?sessionId=' + encodeURIComponent(sessionId || '')).then((res) => {
            if (res && Array.isArray(res.tags)) {
              const counts = {}
              if (Array.isArray(res.memories)) {
                for (const m of res.memories) {
                  const t = m && m.tag
                  if (t) counts[t] = (counts[t] || 0) + 1
                }
              }
              setTags(res.tags.map((t) => ({ tag: t, count: counts[t] || 0 })).filter((x) => x.count > 0))
            }
          }).catch(() => {})
        }
      }, [show])

      const choose = (tag) => {
        if (!tag) return
        if (inputActions && typeof inputActions.setDraft === 'function') {
          inputActions.setDraft('使用 memory_read 工具读取「' + tag + '」记忆。')
        }
      }

      if (!show) return null

      return React.createElement('div', { className: 'dm-picker' },
        React.createElement('div', { className: 'dm-picker-title' }, '选择要读取的记忆标签（点击后填入输入框，回车发送）'),
        tags.length === 0
          ? React.createElement('div', { className: 'dm-picker-empty' }, '记忆库为空（先在「记忆」tab 沉淀记忆）')
          : tags.map((x) => React.createElement('div', { className: 'dm-picker-item', key: x.tag, onClick: () => choose(x.tag) },
              React.createElement('span', null, x.tag),
              React.createElement('span', { className: 'dm-picker-count' }, x.count + ' 条')
            ))
      )
    }

    function MemoryView(props) {
      const useSession = props.useSession
      const sessionId = useSession((s) => s.sessionId)
      const openState = useSession((s) => s.openState)
      const nodeCount = useSession((s) => (s.nodes ? s.nodes.length : 0))

      const [items, setItems] = React.useState([])
      const [selected, setSelected] = React.useState({})
      const [persisted, setPersisted] = React.useState([])
      const [tags, setTags] = React.useState([])
      const [activeTag, setActiveTag] = React.useState('')
      const [addingTag, setAddingTag] = React.useState(false)
      const [newTag, setNewTag] = React.useState('')
      const [reinforced, setReinforced] = React.useState([])
      const [reads, setReads] = React.useState([])
      const [pendingCount, setPendingCount] = React.useState(0)
      const [analyzing, setAnalyzing] = React.useState(false)
      const [lastAnalyzedAt, setLastAnalyzedAt] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [filterTag, setFilterTag] = React.useState('')
      const [confirmDelete, setConfirmDelete] = React.useState(null)

      function fmtConf(v) { return String(parseFloat((Number(v) || 0).toFixed(2))) }

      const applyState = (res) => {
        if (!res) return
        if (Array.isArray(res.items)) setItems(res.items)
        if (Array.isArray(res.memories)) setPersisted(res.memories)
        if (Array.isArray(res.tags)) {
          setTags(res.tags)
          setActiveTag((prev) => (prev && res.tags.indexOf(prev) !== -1 ? prev : (res.tags[0] || '')))
        }
        if (Array.isArray(res.reinforced)) setReinforced(res.reinforced)
        if (Array.isArray(res.reads)) setReads(res.reads)
        setPendingCount(Number(res.pendingCount) || 0)
        setAnalyzing(res.analyzing === true)
        setLastAnalyzedAt(res.lastAnalyzedAt || null)
        if (res.error) setError(res.error)
        else if (res.lastError) setError(res.lastError)
        else setError(null)
      }

      const refreshState = async () => {
        try {
          const res = await apiGet('/api/memory/state?sessionId=' + encodeURIComponent(sessionId || ''))
          applyState(res)
        } catch (e) {}
      }

      React.useEffect(() => { refreshState() }, [])
      React.useEffect(() => { if (openState === 'open') refreshState() }, [openState])
      React.useEffect(() => { if (openState === 'open') refreshState() }, [nodeCount])

      const toggle = (id) => {
        setSelected((prev) => {
          const next = {}
          for (const k in prev) next[k] = prev[k]
          if (next[id]) delete next[id]
          else next[id] = true
          return next
        })
      }

      const selectedIds = items.filter((it) => selected[it.id]).map((it) => it.id)

      const analyzeNow = async () => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
          const res = await apiPost('/api/memory/analyze', { sessionId })
          if (res && res.error) setError(res.error)
          else applyState(res)
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const persistSelected = async () => {
        if (selectedIds.length === 0 || busy || !activeTag) return
        setBusy(true)
        setError(null)
        try {
          for (const it of items) {
            if (!selected[it.id]) continue
            const res = await apiPost('/api/memory/persist', { memory: it, tag: activeTag, sessionId })
            if (res && res.error) {
              setError(res.error)
              break
            }
          }
          setSelected({})
          await refreshState()
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const deleteSelected = async () => {
        if (selectedIds.length === 0) return
        setBusy(true)
        try {
          await apiPost('/api/memory/discard', { ids: selectedIds, sessionId })
          setSelected({})
          await refreshState()
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const confirmAddTag = async () => {
        const tag = String(newTag || '').trim()
        if (!tag) return
        setBusy(true)
        setError(null)
        try {
          const res = await apiPost('/api/memory/addTag', { tag })
          if (res && res.error) setError(res.error)
          else if (res && Array.isArray(res.tags)) {
            setTags(res.tags)
            setActiveTag(tag)
            setNewTag('')
            setAddingTag(false)
          }
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const removeMemory = async (id) => {
        if (busy) return
        setBusy(true)
        setError(null)
        try {
          const res = await apiPost('/api/memory/removeMemory', { id, sessionId })
          if (res && res.error) setError(res.error)
          await refreshState()
        } catch (e) {
          setError(String((e && e.message) || e))
        } finally {
          setBusy(false)
        }
      }

      const confirmRemove = async () => {
        const m = confirmDelete
        setConfirmDelete(null)
        if (m && m.id) await removeMemory(m.id)
      }

      const sorted = items.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

      const thresholdValue = 0.55
      const low = persisted.filter((m) => {
        const eff = m.effectiveConfidence != null ? m.effectiveConfidence : (m.confidence || 0)
        return eff < thresholdValue
      }).sort((a, b) => ((a.effectiveConfidence != null ? a.effectiveConfidence : a.confidence || 0)) - ((b.effectiveConfidence != null ? b.effectiveConfidence : b.confidence || 0)))
      const filtered = filterTag ? persisted.filter((m) => m.tag === filterTag) : persisted
      const sortedPersisted = filtered.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0))

      const statusLine = '已沉淀 ' + persisted.length + ' 条 · 低置信度 ' + low.length + ' 条 · 待分析 ' + pendingCount + ' 条' + (analyzing ? ' · 分析中…' : '') + (lastAnalyzedAt ? ' · 上次分析 ' + String(lastAnalyzedAt).slice(5, 16).replace('T', ' ') : '')

      return React.createElement('div', { className: 'dm-root' },
        React.createElement('div', { className: 'dm-header' },
          React.createElement('div', { className: 'dm-title' }, '记忆'),
          React.createElement('div', { className: 'dm-subtitle' }, statusLine + ' · 每轮结束自动增量分析（deepseek-v4-flash）')
        ),
        React.createElement('div', { className: 'dm-toolbar' },
          React.createElement('button', { className: 'dm-btn', onClick: analyzeNow, disabled: busy || analyzing }, (analyzing ? '分析中…' : '立即分析') + (pendingCount > 0 ? ' (' + pendingCount + ')' : '')),
          React.createElement('button', { className: 'dm-btn', onClick: refreshState, disabled: busy }, '刷新'),
          React.createElement('select', { className: 'dm-select', value: activeTag, onChange: (e) => setActiveTag(e.target.value) },
            tags.map((t) => React.createElement('option', { key: t, value: t }, t))
          ),
          addingTag
            ? React.createElement('span', { className: 'dm-addtag' },
                React.createElement('input', { className: 'dm-input', value: newTag, placeholder: '新标签名', onChange: (e) => setNewTag(e.target.value) }),
                React.createElement('button', { className: 'dm-btn', onClick: confirmAddTag, disabled: busy }, '确定'),
                React.createElement('button', { className: 'dm-btn', onClick: () => { setAddingTag(false); setNewTag('') } }, '取消')
              )
            : React.createElement('button', { className: 'dm-btn', onClick: () => setAddingTag(true) }, '新增标签'),
          React.createElement('button', { className: 'dm-btn dm-btn-primary', onClick: persistSelected, disabled: selectedIds.length === 0 || busy || !activeTag }, '沉淀为记忆 (' + selectedIds.length + ')'),
          React.createElement('button', { className: 'dm-btn dm-btn-danger', onClick: deleteSelected, disabled: selectedIds.length === 0 || busy }, '删除 (' + selectedIds.length + ')')
        ),
        error ? React.createElement('div', { className: 'dm-error' }, error) : null,
        reinforced.length > 0
          ? React.createElement('div', { className: 'dm-notice' },
              '本轮 ' + reinforced.length + ' 条意图与已有记忆归并，已强化置信度：',
              reinforced.map((r, i) => React.createElement('div', { className: 'dm-notice-item', key: i },
                '[' + r.tag + '] ' + r.memoryText + ' → ' + fmtConf(r.confidence || 0) + '（第 ' + r.observations + ' 次观测' + (r.merged ? '，合并 ' + r.merged + ' 条重复记忆' : '') + '）'
              ))
            )
          : null,
        React.createElement('div', { className: 'dm-cols' },
          React.createElement('div', { className: 'dm-col' },
            React.createElement('div', { className: 'dm-col-title' }, '读取记录', React.createElement('span', { className: 'dm-col-count' }, reads.length + ' 次')),
            reads.length === 0
              ? React.createElement('div', { className: 'dm-empty' }, '暂无读取记录')
              : reads.map((r, i) => React.createElement('div', { className: 'dm-read', key: i },
                  React.createElement('div', { className: 'dm-read-title' },
                    '第 ' + r.turn + ' 轮 ' + (r.skipped ? '跳过' : (r.source === '--' ? '手动注入' : '读取')) + ' [' + r.tag + ']' + (r.count > 0 ? ' ' + r.count + ' 条' : '')
                  ),
                  (r.titles && r.titles.length > 0) ? React.createElement('div', { className: 'dm-mem-meta' }, r.titles.join('、')) : null
                ))
          ),
          React.createElement('div', { className: 'dm-col' },
            React.createElement('div', { className: 'dm-col-title' }, '分析结果', React.createElement('span', { className: 'dm-col-count' }, sorted.length + ' 条候选')),
            sorted.length === 0
              ? React.createElement('div', { className: 'dm-empty' }, analyzing ? '正在分析本轮新增消息…' : '暂无候选意图')
              : React.createElement('div', { className: 'dm-list' },
                  sorted.map((it) => {
                    const checked = !!selected[it.id]
                    const conf = it.confidence || 0
                    const confColor = conf >= 0.7 ? 'var(--dsw-alias-state-success-primary)' : (conf >= 0.4 ? 'var(--dsw-alias-state-warn-primary)' : 'var(--dsw-alias-label-secondary)')
                    return React.createElement('div', { className: 'dm-row' + (checked ? ' dm-row-checked' : ''), key: it.id, onClick: () => toggle(it.id) },
                      React.createElement('input', { type: 'checkbox', className: 'dm-check', checked: checked, readOnly: true }),
                      React.createElement('div', { className: 'dm-body' },
                        React.createElement('div', { className: 'dm-text' }, it.text),
                        it.evidence ? React.createElement('div', { className: 'dm-evidence' }, it.evidence) : null,
                        React.createElement('span', { className: 'dm-tag' }, it.category || 'preference')
                      ),
                      React.createElement('div', { className: 'dm-confidence', style: { color: confColor } }, fmtConf(conf))
                    )
                  })
                )
          ),
          React.createElement('div', { className: 'dm-col' },
            React.createElement('div', { className: 'dm-col-title' }, '已沉淀记忆', React.createElement('span', { className: 'dm-col-count' }, persisted.length + ' 条')),
            React.createElement('div', { className: 'dm-filter-row' },
              React.createElement('select', { className: 'dm-select', value: filterTag, onChange: (e) => setFilterTag(e.target.value) },
                React.createElement('option', { value: '' }, '全部分组'),
                tags.map((t) => React.createElement('option', { key: t, value: t }, t))
              )
            ),
            sortedPersisted.length === 0
              ? React.createElement('div', { className: 'dm-empty' }, '暂无已沉淀记忆')
              : sortedPersisted.map((m) => {
                  const eff = m.effectiveConfidence != null ? m.effectiveConfidence : (m.confidence || 0)
                  return React.createElement('div', { className: 'dm-mem', key: m.id },
                    React.createElement('div', { className: 'dm-mem-head' },
                      React.createElement('div', { className: 'dm-mem-text' }, m.text),
                      React.createElement('button', { className: 'dm-btn-small dm-btn-small-danger', onClick: () => setConfirmDelete(m), disabled: busy }, '删除')
                    ),
                    React.createElement('div', { className: 'dm-mem-meta' },
                      '置信度 ' + fmtConf(eff) + ' · 观测 ' + (m.observations || 1) + ' 次' + (m.lastSeen ? ' · 最近 ' + String(m.lastSeen).slice(0, 10) : '')
                    ),
                    React.createElement('div', null, React.createElement('span', { className: 'dm-tag' }, m.tag || '未分类'))
                  )
                })
          )
        ),
        confirmDelete
          ? React.createElement('div', { className: 'dm-modal-mask' },
              React.createElement('div', { className: 'dm-modal' },
                React.createElement('div', { className: 'dm-modal-title' }, '确认删除这条记忆？'),
                React.createElement('div', { className: 'dm-modal-text' }, confirmDelete.text),
                React.createElement('div', { className: 'dm-modal-actions' },
                  React.createElement('button', { className: 'dm-btn', onClick: () => setConfirmDelete(null), disabled: busy }, '取消'),
                  React.createElement('button', { className: 'dm-btn dm-btn-danger', onClick: confirmRemove, disabled: busy }, '确认删除')
                )
              )
            )
          : null
      )
    }

    function apply(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-memory-self-evolution', '')
      style.textContent = CSS
      document.head.appendChild(style)

      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'memory-harvest',
        order: 30,
        label: '记忆'
      }, MemoryView))

      ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay',
        id: 'memory-picker',
        order: 5,
        label: '记忆选择'
      }, MemoryPicker))
    }

    return {
      name: 'dsh-memory-self-evolution',
      inject: ['slots'],
      apply
    }
  }
})
