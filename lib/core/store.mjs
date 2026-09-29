// 记忆存储的平台无关读取层：直接走 node:fs，不依赖任何宿主（DSH ctx / MCP / hook）的文件抽象。
// 写入集中在 writer.mjs，这里只负责读。

import fsp from 'node:fs/promises'
import { DECAY_DAYS, DECAY_STEP, DEFAULT_GROUP, GROUPS, paths } from './config.mjs'

export function normalizeGroup(group) {
  const g = String(group || '').trim().toLowerCase()
  return GROUPS.includes(g) ? g : DEFAULT_GROUP
}

export function fmtConfidence(v) {
  return String(parseFloat((Number(v) || 0).toFixed(2)))
}

// 置信度降序，同分按最近观测时间新的在前。
export function sortMemories(mems) {
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

// 时间衰减后的实际置信度；缺少时间戳时按原始值返回。
export function effectiveConfidence(mem, now = Date.now()) {
  const base = Math.max(0, Number(mem.confidence) || 0)
  const stamp = mem.lastSeen || mem.createdAt
  const lastSeen = stamp ? Date.parse(stamp) : NaN
  if (!Number.isFinite(lastSeen)) return base
  const days = (now - lastSeen) / 86400000
  if (days < DECAY_DAYS) return base
  return Math.max(0, Math.round((base - DECAY_STEP * Math.floor(days / DECAY_DAYS)) * 1e10) / 1e10)
}

async function readTextOrNull(file) {
  try {
    return await fsp.readFile(file, 'utf-8')
  } catch (e) {
    // 文件不存在是正常状态（首次运行 / 该组尚无记忆），其余情况需要留痕便于排查。
    if (e.code !== 'ENOENT') console.error(`[memory] 读取失败 ${file}: ${e.message}`)
    return null
  }
}

export async function readGroup(group) {
  const g = normalizeGroup(group)
  const content = await readTextOrNull(paths.group(g))
  if (!content) return []
  const out = []
  for (const line of content.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const rec = JSON.parse(t)
      if (rec && rec.text) {
        delete rec.observations
        out.push({ ...rec, category: normalizeGroup(rec.category || g) })
      }
    } catch (e) {
      console.error(`[memory] 跳过「${g}」中无法解析的记忆行: ${e.message}`)
    }
  }
  return sortMemories(out)
}

// 返回 { rule: [...], project: [...] }
export async function readAllGroups() {
  const entries = await Promise.all(GROUPS.map(async (g) => [g, await readGroup(g)]))
  return Object.fromEntries(entries)
}

// 全部存活记忆，作为召回池。rule 与 project 一并参与：
// rule 虽在会话开始注入过，但长会话的上下文压缩会把那份丢掉，
// 留在召回池里可以在相关时被重新召回，等于自带补偿。
export async function readAllMemories({ includeDeprecated = false } = {}) {
  const groups = await readAllGroups()
  const all = GROUPS.flatMap((g) => groups[g])
  return includeDeprecated ? all : all.filter((m) => !m.deprecated)
}
