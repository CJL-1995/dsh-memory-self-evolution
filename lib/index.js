export default {
  name: 'dsh-memory-self-evolution',
  inject: ['tools', 'webServer', 'fs', 'sandboxPolicy', 'llm'],
  apply(ctx) {
    const llm = ctx.get('llm')
    const fs = ctx.get('fs')
    const shell = ctx.get('shell')
    const tools = ctx.get('tools')
    const sandboxPolicy = ctx.get('sandboxPolicy')
    const webServer = ctx.get('webServer')

    const ANALYSIS_PROVIDER = 'huoshan-engine'
    const ANALYSIS_MODEL = 'deepseek-v4-flash'
    const root = (sandboxPolicy && typeof sandboxPolicy.workspaceRoot === 'string')
      ? sandboxPolicy.workspaceRoot.replace(/\/+$/, '')
      : '/tmp'
    const DIR_NAME = '.dsh-memory'
    const DEFAULT_TAGS = ['编码规范', '项目背景-输入输出模块', '项目背景-液态玻璃', '项目背景-导航栏']
    const PROJECT_PREFIX = '项目背景'
    const REINFORCE_STEP = 0.1
    const DECAY_STEP = 0.05
    const DECAY_DAYS = 30
    const DEPRECATED_BELOW = 0.55
    const MATCH_THRESHOLD = 0.5
    const DEDUP_THRESHOLD = 0.6
    const SHORTLIST_MAX = 15
    const SHORTLIST_RECENT = 15
    const READ_LIMIT = 50
    const READ_LOG_MAX = 200
    const MAX_CANDIDATES = 50
    const MAX_PENDING = 50
    const INJECT_PREFIX = '【记忆注入'

    let layoutReady = false
    let useDir = false

    function clamp(v) { return Math.max(0, Math.min(1, v)) }
    function fmtConfidence(v) { return String(parseFloat((Number(v) || 0).toFixed(2))) }
    function short(s) { s = String(s || ''); return s.length > 28 ? s.slice(0, 28) + '…' : s }
    function sanitizeTag(tag) {
      return String(tag || '').trim().replace(/[\/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 60)
    }

    async function ensureLayout() {
      if (layoutReady) return useDir
      layoutReady = true
      if (!fs) { useDir = false; return useDir }
      const dir = root + '/' + DIR_NAME
      try {
        const dirTarget = await fs.resolve(dir)
        let info = await fs.stat(dirTarget)
        if (!info && shell) {
          try {
            const spec = shell.resolve({ command: 'mkdir -p "' + dir + '"' })
            await shell.run(spec)
            info = await fs.stat(dirTarget)
          } catch (e) {}
        }
        useDir = !!info
      } catch (e) { useDir = false }
      return useDir
    }

    function tagsFilePath() { return useDir ? root + '/' + DIR_NAME + '/tags.json' : root + '/.dsh-memory.tags.json' }
    function tagFilePath(tag) {
      const safe = sanitizeTag(tag)
      return useDir ? root + '/' + DIR_NAME + '/' + safe + '.jsonl' : root + '/.dsh-memory.' + safe + '.jsonl'
    }
    function candidatesFilePath() { return useDir ? root + '/' + DIR_NAME + '/candidates.json' : root + '/.dsh-memory.candidates.json' }
    function memoryMdFilePath() { return useDir ? root + '/' + DIR_NAME + '/memory.md' : root + '/.dsh-memory.md' }

    function tokenize(s) {
      const m = String(s || '').toLowerCase().match(/[a-z0-9_]+/g)
      return m || []
    }
    function cjkBigrams(s) {
      const str = String(s || '')
      const out = []
      for (let i = 0; i < str.length - 1; i++) {
        const a = str.charCodeAt(i)
        const b = str.charCodeAt(i + 1)
        const aCjk = a >= 0x4e00 && a <= 0x9fff
        const bCjk = b >= 0x4e00 && b <= 0x9fff
        if (!aCjk && !bCjk) continue
        const ca = str[i]
        const cb = str[i + 1]
        if (/\s/.test(ca) || /\s/.test(cb)) continue
        out.push(ca + cb)
      }
      return out
    }
    function jaccard(a, b) {
      const sa = new Set(a)
      const sb = new Set(b)
      if (sa.size === 0 && sb.size === 0) return 0
      let inter = 0
      for (const x of sa) if (sb.has(x)) inter++
      const union = sa.size + sb.size - inter
      return union === 0 ? 0 : inter / union
    }
    function sim(a, b) {
      return Math.max(jaccard(tokenize(a), tokenize(b)), jaccard(cjkBigrams(a), cjkBigrams(b)))
    }

    function sortMemories(mems) {
      return mems.slice().sort((a, b) => {
        const ca = Number(a.confidence) || 0
        const cb = Number(b.confidence) || 0
        if (cb !== ca) return cb - ca
        const ta = String(a.lastSeen || a.createdAt || '')
        const tb = String(b.lastSeen || b.createdAt || '')
        if (tb !== ta) return tb > ta ? 1 : -1
        return 0
      })
    }

    function dedupe(items) {
      const out = []
      for (const it of items) {
        let merged = false
        for (const ex of out) {
          if (sim(it.text, ex.text) >= DEDUP_THRESHOLD) {
            merged = true
            if (it.confidence > ex.confidence) {
              ex.text = it.text
              ex.confidence = it.confidence
              ex.category = it.category
              ex.evidence = it.evidence
            }
            break
          }
        }
        if (!merged) out.push(it)
      }
      return out
    }

    function mergeCandidates(existing, fresh) {
      const out = existing.slice()
      for (const it of fresh) {
        let merged = false
        for (const ex of out) {
          if (sim(it.text, ex.text) >= DEDUP_THRESHOLD) {
            merged = true
            if (it.confidence > ex.confidence) {
              ex.text = it.text
              ex.confidence = it.confidence
              ex.category = it.category
              ex.evidence = it.evidence
            }
            break
          }
        }
        if (!merged) out.push(it)
      }
      out.sort((a, b) => b.confidence - a.confidence)
      return out.slice(0, MAX_CANDIDATES)
    }

    async function readJsonFile(path, fallback) {
      try {
        const target = await fs.resolve(path)
        const info = await fs.stat(target)
        if (!info) return fallback
        const content = await fs.readText(target)
        return JSON.parse(content)
      } catch (e) { return fallback }
    }
    async function writeJsonFile(path, value) {
      const target = await fs.resolve(path)
      await fs.writeText(target, JSON.stringify(value))
    }

    async function readTags() {
      await ensureLayout()
      const raw = await readJsonFile(tagsFilePath(), null)
      const set = new Set(DEFAULT_TAGS)
      if (Array.isArray(raw)) {
        for (const t of raw) {
          const v = String(t || '').trim()
          if (v) set.add(v)
        }
      }
      return Array.from(set)
    }
    async function writeTags(tags) { await writeJsonFile(tagsFilePath(), tags) }

    async function readMemoriesOfTag(tag) {
      try {
        const target = await fs.resolve(tagFilePath(tag))
        const info = await fs.stat(target)
        if (!info) return []
        const content = await fs.readText(target)
        const out = []
        for (const line of content.split('\n')) {
          const t = line.trim()
          if (!t) continue
          try { out.push(JSON.parse(t)) } catch (e) {}
        }
        return sortMemories(out)
      } catch (e) { return [] }
    }
    async function writeMemoriesOfTag(tag, memories) {
      const target = await fs.resolve(tagFilePath(tag))
      const sorted = sortMemories(memories)
      const body = sorted.map((m) => JSON.stringify(m)).join('\n')
      await fs.writeText(target, sorted.length ? body + '\n' : '')
    }
    async function readAllMemories() {
      const tags = await readTags()
      const all = []
      for (const tag of tags) {
        const mems = await readMemoriesOfTag(tag)
        for (const m of mems) {
          m.tag = m.tag || tag
          all.push(m)
        }
      }
      return all
    }
    async function findMemoryById(id) {
      const tags = await readTags()
      for (const tag of tags) {
        const mems = await readMemoriesOfTag(tag)
        for (let i = 0; i < mems.length; i++) {
          if (mems[i] && mems[i].id === id) return { tag, mems, idx: i }
        }
      }
      return null
    }

    function effectiveConfidence(mem, now) {
      const base = Math.max(0, Number(mem.confidence) || 0)
      const lastSeen = mem.lastSeen ? Date.parse(mem.lastSeen) : (mem.createdAt ? Date.parse(mem.createdAt) : NaN)
      if (!Number.isFinite(lastSeen)) return base
      const days = (now - lastSeen) / 86400000
      if (days < DECAY_DAYS) return base
      const steps = Math.floor(days / DECAY_DAYS)
      return Math.max(0, base - DECAY_STEP * steps)
    }

    const sessionStates = {}
    function stateFor(sid) {
      const key = String(sid || 'unknown')
      if (!sessionStates[key]) {
        sessionStates[key] = {
          pending: [],
          candidates: [],
          candidatesLoaded: false,
          analyzing: false,
          lastAnalyzedAt: null,
          lastError: null,
          reinforced: [],
          reads: [],
          currentTurn: 1,
          chain: Promise.resolve()
        }
      }
      return sessionStates[key]
    }
    function pushRead(st, entry) {
      st.reads.push(entry)
      if (st.reads.length > READ_LOG_MAX) st.reads.splice(0, st.reads.length - READ_LOG_MAX)
    }

    async function loadCandidatesMap() {
      await ensureLayout()
      const map = await readJsonFile(candidatesFilePath(), {})
      return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {}
    }
    async function ensureCandidatesLoaded(sid, st) {
      if (st.candidatesLoaded) return
      st.candidatesLoaded = true
      try {
        const map = await loadCandidatesMap()
        const arr = map[sid]
        if (Array.isArray(arr)) st.candidates = arr.filter((x) => x && typeof x.text === 'string')
      } catch (e) {}
    }
    async function saveCandidatesFor(sid, st) {
      try {
        const map = await loadCandidatesMap()
        map[sid] = st.candidates
        await writeJsonFile(candidatesFilePath(), map)
      } catch (e) {}
    }

    function extractTextBlocks(content) {
      if (!Array.isArray(content)) return ''
      return content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
        .trim()
    }

    async function complete(options) {
      if (!llm) throw new Error('llm service unavailable')
      let text = ''
      for await (const chunk of llm.stream(options)) {
        if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
        } else if (chunk && chunk.type === 'finish' && chunk.reason && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
          const msg = chunk.reason.failure ? chunk.reason.failure.message : chunk.reason.kind
          throw new Error('LLM failed: ' + msg)
        }
      }
      return text
    }

    function parseIntentJson(raw) {
      let s = String(raw || '').trim()
      s = s.replace(/```json/gi, '').replace(/```/g, '')
      const start = s.indexOf('[')
      const end = s.lastIndexOf(']')
      if (start === -1 || end === -1 || end <= start) return []
      try {
        const arr = JSON.parse(s.slice(start, end + 1))
        return Array.isArray(arr) ? arr : []
      } catch (e) { return [] }
    }

    // ---- 向量索引（语义召回，替代 Jaccard 粗筛）----
    let vecIndex = new Map()
    let vecLoaded = false
    function vecFilePath() { return useDir ? root + '/' + DIR_NAME + '/embeddings.jsonl' : root + '/.dsh-memory.embeddings.jsonl' }
    async function loadVecIndex() {
      if (vecLoaded) return
      vecLoaded = true
      try {
        const target = await fs.resolve(vecFilePath())
        const info = await fs.stat(target)
        if (!info) return
        const content = await fs.readText(target)
        for (const line of content.split('\n')) {
          const t = line.trim()
          if (!t) continue
          try {
            const rec = JSON.parse(t)
            if (rec && rec.id && Array.isArray(rec.v)) vecIndex.set(rec.id, rec.v)
          } catch (e) {}
        }
      } catch (e) {}
    }
    async function saveVecIndex() {
      try {
        const lines = []
        for (const [id, v] of vecIndex) lines.push(JSON.stringify({ id, v }))
        await fs.writeText(await fs.resolve(vecFilePath()), lines.join('\n'))
      } catch (e) {}
    }
    async function ensureVecFor(mem) {
      try {
        await loadVecIndex()
        if (vecIndex.has(mem.id)) return
        const mod = await import('./embedding.js')
        const vecs = await mod.embed([mem.text])
        if (vecs && vecs[0]) {
          vecIndex.set(mem.id, vecs[0])
          await saveVecIndex()
        }
      } catch (e) {}
    }
    function removeVec(id) {
      if (vecIndex.has(id)) {
        vecIndex.delete(id)
        saveVecIndex().catch(() => {})
      }
    }
    async function ensureVecsFor(memories) {
      try {
        await loadVecIndex()
        const missing = memories.filter((m) => !vecIndex.has(m.id))
        if (missing.length === 0) return
        const mod = await import('./embedding.js')
        const vecs = await mod.embed(missing.map((m) => m.text))
        let changed = false
        missing.forEach((m, i) => {
          if (vecs[i]) {
            vecIndex.set(m.id, vecs[i])
            changed = true
          }
        })
        if (changed) await saveVecIndex()
      } catch (e) {}
    }
    async function searchVec(queryTexts, k) {
      try {
        await loadVecIndex()
        if (vecIndex.size === 0) return []
        const mod = await import('./embedding.js')
        const qvecs = await mod.embed(queryTexts)
        const scored = []
        for (const [id, v] of vecIndex) {
          let best = 0
          for (const q of qvecs) {
            const s = mod.cosine(q, v)
            if (s > best) best = s
          }
          scored.push({ id, score: best })
        }
        scored.sort((a, b) => b.score - a.score)
        return scored.slice(0, k).map((x) => x.id)
      } catch (e) {
        return []
      }
    }

    async function buildShortlist(memories, texts) {
      if (!memories || memories.length === 0) return []
      // 语义召回：向量 top-k（失败/为空时回退到最近 N 条）
      let vectorIds = []
      try {
        vectorIds = await searchVec(texts, SHORTLIST_RECENT)
      } catch (e) { vectorIds = [] }
      const vecSet = new Set(vectorIds)
      const byVec = memories.filter((m) => vecSet.has(m.id))
      const byRecency = memories.slice().sort((a, b) => {
        const ta = Date.parse(a.lastSeen || a.createdAt || '') || 0
        const tb = Date.parse(b.lastSeen || b.createdAt || '') || 0
        return tb - ta
      }).slice(0, SHORTLIST_RECENT)
      const seen = new Set()
      const out = []
      for (const m of byVec.concat(byRecency)) {
        if (seen.has(m.id)) continue
        seen.add(m.id)
        out.push(m)
        if (out.length >= SHORTLIST_MAX) break
      }
      return out
    }

    async function extractIntents(texts, memories) {
      const transcript = texts.map((t, i) => (i + 1) + '. ' + t).join('\n')
      const shortlist = await buildShortlist(memories, texts)
      const memBlock = shortlist.map((m, i) => (i + 1) + '. ' + m.text).join('\n')
      const system = [
        '你在编程会话中挖掘可长期沉淀的记忆：提取用户隐式或显式表达的偏好、规则、习惯、项目事实，以及反复出现的纠正。',
        '下面会同时给你「新会话消息」和「已有记忆候选」两份材料。你要判断每条值得沉淀的意图属于「新建」还是「强化已有记忆」。',
        '判定标准：只有「语义等价」（表达的是同一条规则/偏好/事实，仅措辞不同）才算重复，输出 reinforce；「主题相近但场景/动作不同」（例如「用中文回答」vs「沉淀记忆用中文」）视为不同意图，输出 new。',
        '忽略一次性请求和临时任务细节。',
        '只返回 JSON 数组，不要 markdown 代码围栏，不要任何多余文字。每个元素二选一：',
        '新建 {"type":"new","text":"一句清晰可执行的话","confidence":0.0-1.0,"category":"preference|rule|project|habit|feedback","evidence":"简短佐证"}',
        '强化 {"type":"reinforce","reinforce_memory":"<与已有记忆候选一字不差的那条文本>","evidence":"简短佐证"}',
        'confidence 表示用户表达的明确程度，越明确越高。',
        'text 和 evidence 必须全部使用简体中文，禁止翻译成英文；技术术语和专有名词（如 git、commit、API）可保留英文原文。',
        '最多输出 8 条，按 confidence 从高到低排序。没有值得记住的内容就输出 []。'
      ].join('\n')
      const raw = await complete({
        provider: ANALYSIS_PROVIDER,
        model: ANALYSIS_MODEL,
        system,
        messages: [{ id: 'mem-miner-' + Date.now().toString(36), role: 'user', content: [{ type: 'text', text: '需要挖掘的新会话消息：\n' + transcript + '\n\n已有记忆候选（判断是否重复，重复则强化而非新建）：\n' + (memBlock || '（暂无）') }], source: { kind: 'user' } }],
        temperature: 0.2,
        maxTokens: 1500
      })
      const parsed = parseIntentJson(raw)
      const candidates = []
      const reinforcements = []
      for (const item of parsed) {
        const type = String((item && item.type) || 'new').trim()
        if (type === 'reinforce') {
          const rm = String((item && item.reinforce_memory) || '').trim()
          if (rm) reinforcements.push({ reinforceMemory: rm, evidence: String((item && item.evidence) || '').trim() })
        } else {
          const text = String((item && (item.text || item.intent)) || '').trim()
          if (!text) continue
          let confidence = Number(item && item.confidence)
          if (!Number.isFinite(confidence)) confidence = 0.5
          candidates.push({
            text,
            confidence: Math.max(0.5, clamp(confidence)),
            category: String((item && item.category) || 'preference'),
            evidence: String((item && item.evidence) || '').trim()
          })
        }
      }
      const deduped = dedupe(candidates)
      deduped.sort((a, b) => b.confidence - a.confidence)
      return {
        candidates: deduped.map((it, i) => ({
          id: 'cand-' + Date.now().toString(36) + '-' + i,
          text: it.text,
          confidence: it.confidence,
          category: it.category,
          evidence: it.evidence
        })),
        reinforcements
      }
    }

    async function analyzeSession(sid) {
      const st = stateFor(sid)
      if (st.pending.length === 0) return
      if (st.analyzing) return
      st.analyzing = true
      st.lastError = null
      const texts = st.pending.splice(0, st.pending.length)
      try {
        await ensureCandidatesLoaded(sid, st)
        const memories = await readAllMemories()
        const now = Date.now()
        const nowIso = new Date(now).toISOString()
        await ensureVecsFor(memories)
        const { candidates, reinforcements } = await extractIntents(texts, memories)
        const changedTags = {}
        const reinforced = []
        const touched = new Set()
        function bump(m) {
          if (touched.has(m.id)) return
          touched.add(m.id)
          m.confidence = (Number(m.confidence) || 0) + REINFORCE_STEP
          m.observations = (Number(m.observations) || 1) + 1
          m.lastSeen = nowIso
          changedTags[m.tag] = true
          reinforced.push({
            memoryText: m.text,
            tag: m.tag,
            confidence: effectiveConfidence(m, now),
            observations: m.observations,
            merged: 0
          })
        }
        // 1) LLM 判定为「强化」：按文本定位已有记忆，强化而非新建
        for (const r of reinforcements) {
          let target = memories.find((x) => x.text === r.reinforceMemory)
          if (!target) {
            let best = null
            let bestScore = 0
            for (const m of memories) {
              const s = sim(r.reinforceMemory, m.text)
              if (s > bestScore) { bestScore = s; best = m }
            }
            if (best && bestScore >= MATCH_THRESHOLD) target = best
          }
          if (target) bump(target)
        }
        // 2) 新建候选：语义等价判断已由 LLM 在挖掘时完成，直接进候选
        const fresh = candidates
        for (const tag of Object.keys(changedTags)) {
          const mems = memories.filter((x) => x.tag === tag)
          try { await writeMemoriesOfTag(tag, mems) } catch (e) {}
        }
        st.candidates = mergeCandidates(st.candidates, fresh)
        st.reinforced = reinforced
        st.lastAnalyzedAt = nowIso
        await saveCandidatesFor(sid, st)
        await writeMemoryMdFile()
      } catch (e) {
        st.lastError = (e && e.message) || 'analysis failed'
        st.pending = texts.concat(st.pending)
      } finally {
        st.analyzing = false
      }
    }

    function sessionIdOf(payload) {
      try {
        const agent = payload && payload.agent
        const session = agent && agent.session
        const id = session && session.id
        return id ? String(id) : null
      } catch (e) { return null }
    }

    ctx.on('agent/inbox/claimed', (payload) => {
      try {
        const sid = sessionIdOf(payload)
        if (!sid) return
        const st = stateFor(sid)
        if (typeof payload.turn === 'number') st.currentTurn = payload.turn
        const msg = payload && payload.message
        if (!msg || msg.role !== 'user') return
        if (msg.source && msg.source.kind === 'tool') return
        const text = extractTextBlocks(msg.content)
        if (!text) return
        if (text.startsWith('--')) return
        if (text.startsWith(INJECT_PREFIX)) return
        if (st.pending.length < MAX_PENDING) st.pending.push(text)
      } catch (e) {}
    })

    ctx.on('agent/turn-stopping', (payload) => {
      const sid = sessionIdOf(payload)
      if (!sid) return
      const st = stateFor(sid)
      st.chain = st.chain.then(() => analyzeSession(sid)).catch(() => {})
    })

    async function buildMemoryMarkdown(sid) {
      const tags = await readTags()
      const userTags = tags.filter((t) => t.indexOf(PROJECT_PREFIX) !== 0)
      const projectTags = tags.filter((t) => t.indexOf(PROJECT_PREFIX) === 0)
      const st = sid ? stateFor(sid) : null
      const readByTag = {}
      if (st) {
        for (const r of st.reads) {
          if (r.skipped) continue
          if (!readByTag[r.tag]) readByTag[r.tag] = r
        }
      }
      const lines = []
      lines.push('# 长期记忆库（自动生成，请勿手动编辑）')
      lines.push('')
      lines.push('你拥有跨会话的长期记忆。本文件规定哪些记忆已生效、其余如何按需读取。')
      lines.push('')
      lines.push('## 一、用户级别记忆（全量生效，必须遵守）')
      lines.push('')
      let userTotal = 0
      for (const tag of userTags) {
        const mems = await readMemoriesOfTag(tag)
        if (mems.length === 0) continue
        userTotal += mems.length
        const top = mems.slice(0, READ_LIMIT)
        lines.push('### ' + tag + '（共 ' + mems.length + ' 条' + (mems.length > READ_LIMIT ? '，已按置信度截取前 ' + READ_LIMIT : '') + '）')
        top.forEach((m, i) => {
          lines.push((i + 1) + '. ' + m.text + '（置信度 ' + fmtConfidence(m.confidence) + '）')
        })
        lines.push('')
      }
      if (userTotal === 0) lines.push('（暂无）')
      lines.push('')
      lines.push('## 二、项目背景记忆索引（按需路由阅读）')
      lines.push('')
      lines.push('当用户提到或询问与下列任一标签相关的内容时——即使只是自然语言描述、没有明说「读取记忆」（例如提到「输入输出模块」「液态玻璃」等）——你必须先调用 memory_read(对应标签) 读取记忆，再据此回答；不要凭已有认知直接回答，也不要跳过记忆。与当前任务无关的标签不要读。')
      lines.push('')
      let projectTotal = 0
      const rows = []
      for (const tag of projectTags) {
        const mems = await readMemoriesOfTag(tag)
        if (mems.length === 0) continue
        projectTotal += mems.length
        const r = readByTag[tag]
        const status = r ? ('第 ' + r.turn + ' 轮已读') : '未读'
        rows.push('| ' + tag + ' | ' + mems.length + ' | ' + status + ' |')
      }
      if (projectTotal === 0) {
        lines.push('（暂无）')
      } else {
        lines.push('| 标签 | 条数 | 状态 |')
        lines.push('|---|---|---|')
        for (const row of rows) lines.push(row)
      }
      lines.push('')
      lines.push('## 三、读取规则')
      lines.push('')
      lines.push('- memory_read(tag)：返回该标签记忆；文件已按「置信度降序，同分按最近观测时间新的在前」排序。用户自然语言提到相关主题（如「输入输出模块」）时即应主动调用，不必等用户明说「读取记忆」。')
      lines.push('  ≤50 条全量返回，>50 条返回前 50 条并注明总量。')
      lines.push('- 每个标签每会话只需读一次：重复调用只返回「已读/无变化」或「新增」条目。')
      lines.push('')
      lines.push('## 四、`--` 快捷指令（用户手动注入）')
      lines.push('')
      lines.push('- 用户输入 `--`：列出记忆库目录；输入 `-- <标签名或序号>` 注入该标签记忆。')
      lines.push('')
      lines.push('## 五、生效规则')
      lines.push('')
      lines.push('本文件及索引指向的记忆均为用户确认过的有效记忆；记忆由系统自动演化，只有用户手动删除才会真正移除。')
      return lines.join('\n')
    }

    async function writeMemoryMdFile() {
      try {
        await ensureLayout()
        const md = await buildMemoryMarkdown(null)
        const target = await fs.resolve(memoryMdFilePath())
        await fs.writeText(target, md)
      } catch (e) {}
    }

    ctx.on('system-prompt/assemble', async (assembly, context, next) => {
      try {
        const md = await buildMemoryMarkdown(null)
        if (md) {
          const sections = assembly && Array.isArray(assembly.sections) ? assembly.sections : []
          sections.push({ name: 'memory-harvest:memory', text: md })
        }
      } catch (e) {}
      return next(assembly)
    })

    async function handleCommand(cmd, sid, turn) {
      const st = stateFor(sid)
      const tags = await readTags()
      const listTags = []
      for (const tag of tags) {
        const mems = await readMemoriesOfTag(tag)
        if (mems.length > 0) listTags.push(tag)
      }
      const label = String(cmd || '').slice(2).trim()
      if (!label) {
        const lines = ['用户输入了记忆库目录指令。请直接按下面格式向用户列出记忆库可选目录，不要调用其它工具：', '', '记忆库目录：']
        listTags.forEach((tag, i) => {
          const kind = tag.indexOf(PROJECT_PREFIX) === 0 ? '项目级（按需读取）' : '用户级（已默认注入）'
          lines.push((i + 1) + '. ' + tag + '（' + kind + '）')
        })
        lines.push('', '用法：输入 "-- <标签名或序号>" 可注入该标签全部记忆。')
        return lines.join('\n')
      }
      let tag = null
      if (/^\d+$/.test(label)) {
        const idx = parseInt(label, 10) - 1
        if (idx >= 0 && idx < listTags.length) tag = listTags[idx]
      } else {
        for (const t of tags) if (t === label) { tag = t; break }
      }
      if (!tag) {
        return '用户输入了无效的记忆标签 "' + label + '"。请提示用户输入 "--" 查看可用目录。'
      }
      return '使用 memory_read 工具读取「' + tag + '」记忆。'
    }

    ctx.on('agent/pre-step', (payload, next) => {
      const messages = payload && payload.messages
      if (!Array.isArray(messages) || !payload.agent) return next(payload)
      let idx = -1
      let cmd = null
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m && m.role === 'user') {
          const t = extractTextBlocks(m.content)
          if (t.startsWith('--')) { idx = i; cmd = t; break }
        }
      }
      if (idx < 0) return next(payload)
      const sid = sessionIdOf(payload)
      const turn = stateFor(sid).currentTurn || 1
      return handleCommand(cmd, sid, turn).then((text) => {
        const m = messages[idx]
        const replaced = messages.slice()
        replaced[idx] = { id: m.id, role: 'user', content: [{ type: 'text', text: text }], source: m.source }
        return { kind: 'enter', messages: replaced }
      })
    })

    if (tools) {
      const memoryReadTool = {
        name: 'memory_read',
        description: '读取某个标签下已沉淀的长期记忆（内容已按置信度降序、同分按最近观测时间排序）。当用户提到或询问某个项目/模块/背景（例如「输入输出模块」「液态玻璃」）时，即使没有明说「读取记忆」，也应先调用本工具读取对应标签的记忆再回答，不要跳过记忆直接作答。≤50 条全量返回，>50 条返回前 50 条。',
        parameters: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: '标签名，例如 项目背景-液态玻璃' }
          },
          required: ['tag'],
          additionalProperties: false
        },
        output: {
          schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
          render: (args, value) => [{ type: 'text', text: (value && value.text) || '' }]
        },
        execute: async (args, exec) => {
          const tag = String((args && args.tag) || '').trim()
          if (!tag) return { text: '错误：缺少 tag 参数。' }
          const mems = await readMemoriesOfTag(tag)
          const sid = sessionIdOf(exec)
          if (sid) {
            const st = stateFor(sid)
            pushRead(st, { turn: st.currentTurn || 1, skipped: mems.length === 0, source: 'tool', tag, count: mems.length })
          }
          const top = mems.slice(0, READ_LIMIT)
          if (mems.length === 0) {
            return { text: '标签「' + tag + '」下暂无记忆。' }
          }
          const lines = ['标签「' + tag + '」共 ' + mems.length + ' 条' + (mems.length > READ_LIMIT ? '（已按置信度截取前 ' + READ_LIMIT + '）' : '') + '：']
          top.forEach((m, i) => { lines.push((i + 1) + '. ' + m.text) })
          return { text: lines.join('\n') }
        }
      }
      ctx.effect(() => tools.register(memoryReadTool))
    }

    // ---- HTTP RPC（供 client 半 fetch 调用） ----
    function parseQuery(url) {
      const out = {}
      const idx = String(url || '').indexOf('?')
      if (idx === -1) return out
      for (const pair of String(url).slice(idx + 1).split('&')) {
        const eq = pair.indexOf('=')
        if (eq === -1) { if (pair) out[decodeURIComponent(pair)] = '' }
        else out[decodeURIComponent(pair.slice(0, eq))] = decodeURIComponent(pair.slice(eq + 1))
      }
      return out
    }
    function readBody(req) {
      return new Promise((resolve) => {
        let data = ''
        req.on('data', (c) => { data += c })
        req.on('end', () => {
          try { resolve(data ? JSON.parse(data) : {}) } catch (e) { resolve({}) }
        })
        req.on('error', () => resolve({}))
      })
    }
    function sendJson(res, obj, status) {
      const body = JSON.stringify(obj)
      res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(body)
    }

    async function buildState(sid) {
      const st = stateFor(sid)
      await ensureCandidatesLoaded(sid, st)
      const tags = await readTags()
      const now = Date.now()
      const all = await readAllMemories()
      const memories = all.map((m) => {
        const eff = effectiveConfidence(m, now)
        return {
          id: m.id,
          text: m.text,
          confidence: Math.max(0, Number(m.confidence) || 0),
          effectiveConfidence: eff,
          category: m.category,
          evidence: m.evidence,
          tag: m.tag,
          observations: Number(m.observations) || 1,
          lastSeen: m.lastSeen || null,
          deprecated: eff < DEPRECATED_BELOW
        }
      })
      return {
        items: st.candidates,
        tags,
        memories,
        reads: st.reads,
        pendingCount: st.pending.length,
        analyzing: st.analyzing,
        lastAnalyzedAt: st.lastAnalyzedAt,
        lastError: st.lastError,
        reinforced: st.reinforced
      }
    }

    if (webServer) {
      webServer.register({ kind: 'exact', path: '/api/memory/state', handler: async (req, res) => {
        try {
          const sid = parseQuery(req.url).sessionId || 'unknown'
          sendJson(res, await buildState(sid))
        } catch (e) { sendJson(res, { error: (e && e.message) || 'state failed' }, 500) }
      }})

      webServer.register({ kind: 'exact', path: '/api/memory/analyze', handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const sid = body.sessionId || 'unknown'
          await analyzeSession(sid)
          sendJson(res, await buildState(sid))
        } catch (e) { sendJson(res, { error: (e && e.message) || 'analyze failed' }, 500) }
      }})

      webServer.register({ kind: 'exact', path: '/api/memory/persist', handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const memory = body.memory
          const tag = sanitizeTag(body.tag || '')
          const text = String((memory && memory.text) || '').trim()
          if (!text || !tag) { sendJson(res, { ok: false, error: 'empty memory or tag' }, 400); return }
          await ensureLayout()
          const tags = await readTags()
          if (tags.indexOf(tag) === -1) { tags.push(tag); await writeTags(tags) }
          const mems = await readMemoriesOfTag(tag)
          if (!mems.some((m) => String(m.text || '').trim() === text)) {
            const now = new Date().toISOString()
            mems.push({
              id: 'mem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
              text,
              confidence: clamp(Number(memory.confidence) || 0.5),
              category: String(memory.category || 'preference'),
              evidence: String(memory.evidence || ''),
              tag,
              observations: 1,
              firstSeen: now,
              lastSeen: now,
              deprecated: false,
              sessionId: body.sessionId ? String(body.sessionId) : null,
              createdAt: now
            })
            await writeMemoriesOfTag(tag, mems)
            ensureVecFor(mems[mems.length - 1]).catch(() => {})
          }
          const sid = body.sessionId || 'unknown'
          const st = stateFor(sid)
          await ensureCandidatesLoaded(sid, st)
          const mid = memory && memory.id
          st.candidates = st.candidates.filter((c) => (mid ? c.id !== mid : c.text !== text))
          await saveCandidatesFor(sid, st)
          await writeMemoryMdFile()
          sendJson(res, { ok: true })
        } catch (e) { sendJson(res, { ok: false, error: (e && e.message) || 'persist failed' }, 500) }
      }})

      webServer.register({ kind: 'exact', path: '/api/memory/discard', handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const sid = body.sessionId || 'unknown'
          const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
          const st = stateFor(sid)
          await ensureCandidatesLoaded(sid, st)
          const set = new Set(ids)
          st.candidates = st.candidates.filter((c) => !set.has(c.id))
          await saveCandidatesFor(sid, st)
          sendJson(res, { ok: true })
        } catch (e) { sendJson(res, { ok: false, error: (e && e.message) || 'discard failed' }, 500) }
      }})

      webServer.register({ kind: 'exact', path: '/api/memory/addTag', handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const tag = sanitizeTag(body.tag || '')
          if (!tag) { sendJson(res, { ok: false, error: 'empty tag' }, 400); return }
          await ensureLayout()
          const tags = await readTags()
          if (tags.indexOf(tag) !== -1) { sendJson(res, { ok: true, tags, existed: true }); return }
          tags.push(tag)
          await writeTags(tags)
          const target = await fs.resolve(tagFilePath(tag))
          const info = await fs.stat(target)
          if (!info) await fs.writeText(target, '')
          await writeMemoryMdFile()
          sendJson(res, { ok: true, tags, created: true })
        } catch (e) { sendJson(res, { ok: false, error: (e && e.message) || 'add tag failed' }, 500) }
      }})

      webServer.register({ kind: 'exact', path: '/api/memory/removeMemory', handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const id = String(body.id || '')
          if (!id) { sendJson(res, { ok: false, error: 'missing id' }, 400); return }
          const found = await findMemoryById(id)
          if (!found) { sendJson(res, { ok: false, error: 'memory not found' }, 404); return }
          found.mems.splice(found.idx, 1)
          await writeMemoriesOfTag(found.tag, found.mems)
          removeVec(id)
          await writeMemoryMdFile()
          sendJson(res, { ok: true })
        } catch (e) { sendJson(res, { ok: false, error: (e && e.message) || 'remove failed' }, 500) }
      }})
    }
  }
}
