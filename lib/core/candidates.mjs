// 候选池：模型不在场时的兜底沉淀通路。
// stop hook 读 transcript，按信号词粗筛出「可能值得长期记住」的用户表达，
// 以全局候选池累积 observations——跨会话反复出现的才值得沉淀，一次性噪音只会出现一次。
// 这里刻意不调用任何 LLM：判断权交给下次会话的模型和用户，本模块只负责收集与计数。

import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import { ROOT, paths } from './config.mjs'

const MAX_CANDIDATES = 100
// 被拒绝的候选在此期限内不再重复提问。
const REJECT_COOLDOWN_DAYS = 30

// 表达「跨轮次约定」而非一次性请求的信号词。粗筛用，宁多勿漏，精判交给模型。
const SIGNAL_PATTERNS = [
  /以后|今后|后续|下次|每次|always|从现在开始/,
  /记住|记一下|别忘|牢记/,
  /不要再|别再|不准|禁止|不许/,
  /一律|统一|始终|默认|约定|规范|习惯/,
  /我说过|又.{0,4}了|提醒过/,
]

function fingerprint(text) {
  // 去掉空白与常见标点后哈希，让措辞微调仍能落到同一个候选上。
  const norm = String(text || '')
    .toLowerCase()
    .replace(/[\s，。、；：！？,.;:!?"'「」（）()]/g, '')
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16)
}

async function readPool() {
  try {
    const raw = await fsp.readFile(paths.candidates, 'utf-8')
    const parsed = JSON.parse(raw)
    // 兼容 DSH 时期「按 sessionId 分桶」的旧结构：那种结构下没有全局候选，视为空池重新开始。
    if (!parsed || !Array.isArray(parsed.candidates)) return { candidates: [], rejected: [] }
    return { candidates: parsed.candidates, rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [] }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[memory] 读取候选池失败，按空池处理: ${e.message}`)
    return { candidates: [], rejected: [] }
  }
}

async function writePool(pool) {
  const tmp = `${paths.candidates}.tmp.${process.pid}`
  try {
    await fsp.mkdir(ROOT, { recursive: true })
    await fsp.writeFile(tmp, JSON.stringify(pool, null, 2), 'utf-8')
    await fsp.rename(tmp, paths.candidates)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    console.error(`[memory] 写入候选池失败: ${e.message}`)
  }
}

// 从 transcript 里取出用户的真实输入。
//
// 关键：注入给模型的记忆文本会作为 system_reminder 出现在用户消息里。若不剥离，
// 分析会把「自己刚注入的记忆」当成「用户又说了一次」，observations 不断累加、
// 置信度自我确认地上涨，形成正反馈——旧记忆虚高、新信号被压制。
// 因此只取 <user_query> 内的内容，拿不到就整条丢弃，宁可漏采不可回声。
export function extractUserQueries(transcriptText) {
  const out = []
  for (const line of transcriptText.split('\n')) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch (e) {
      console.error(`[memory] 跳过 transcript 中无法解析的行: ${e.message}`)
      continue
    }
    if (row.role !== 'user') continue
    const content = row.message && row.message.content
    const blocks = Array.isArray(content) ? content : [{ type: 'text', text: content }]
    for (const b of blocks) {
      if (!b || b.type !== 'text' || typeof b.text !== 'string') continue
      const m = b.text.match(/<user_query>([\s\S]*?)<\/user_query>/)
      if (!m) continue
      const q = m[1].trim()
      if (q) out.push(q)
    }
  }
  return out
}

export function looksWorthRemembering(text) {
  const t = String(text || '').trim()
  // 过短的输入（「好」「继续」「嗯」）不可能是值得沉淀的约定。
  if (t.length < 6) return false
  return SIGNAL_PATTERNS.some((re) => re.test(t))
}

// 把本轮命中的表达并入候选池，已存在的累加 observations。返回本次新增/强化的条数。
export async function collectCandidates(queries, sessionId) {
  const hits = queries.filter(looksWorthRemembering)
  if (hits.length === 0) return { added: 0, reinforced: 0 }

  const pool = await readPool()
  const now = new Date().toISOString()
  const cutoff = Date.now() - REJECT_COOLDOWN_DAYS * 86400000
  const rejected = new Set(
    pool.rejected.filter((r) => Date.parse(r.until || '') > cutoff).map((r) => r.fingerprint)
  )

  let added = 0
  let reinforced = 0
  for (const text of hits) {
    const fp = fingerprint(text)
    if (rejected.has(fp)) continue
    const existing = pool.candidates.find((c) => c.fingerprint === fp)
    if (existing) {
      existing.observations = (Number(existing.observations) || 1) + 1
      existing.lastSeen = now
      if (sessionId && !existing.sessions.includes(sessionId)) existing.sessions.push(sessionId)
      reinforced++
    } else {
      pool.candidates.push({
        fingerprint: fp,
        text,
        observations: 1,
        firstSeen: now,
        lastSeen: now,
        sessions: sessionId ? [sessionId] : [],
      })
      added++
    }
  }

  // 超量时丢观测次数最少、最久未出现的，保留高频信号。
  if (pool.candidates.length > MAX_CANDIDATES) {
    pool.candidates.sort((a, b) => (b.observations - a.observations) || (Date.parse(b.lastSeen) - Date.parse(a.lastSeen)))
    pool.candidates.length = MAX_CANDIDATES
  }

  await writePool(pool)
  return { added, reinforced }
}

export async function countPendingCandidates() {
  const pool = await readPool()
  return pool.candidates.length
}

export async function listCandidates() {
  const pool = await readPool()
  return pool.candidates
    .slice()
    .sort((a, b) => (b.observations - a.observations) || (Date.parse(b.lastSeen) - Date.parse(a.lastSeen)))
}

export async function dropCandidate(fingerprint, { reject = false } = {}) {
  const pool = await readPool()
  const idx = pool.candidates.findIndex((c) => c.fingerprint === fingerprint)
  if (idx < 0) return false
  pool.candidates.splice(idx, 1)
  if (reject) {
    const until = new Date(Date.now() + REJECT_COOLDOWN_DAYS * 86400000).toISOString()
    pool.rejected.push({ fingerprint, until })
  }
  await writePool(pool)
  return true
}
