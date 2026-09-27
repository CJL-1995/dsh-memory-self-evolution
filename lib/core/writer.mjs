// 记忆写入层。多端（Cursor / codebuddy）与短命进程会并发写，因此：
//   新增记忆 —— 追加写单行 jsonl，单行小于 4096 字节时内核保证原子，不会写串
//   强化 / 标记变更 —— 读改写整个文件，走「临时文件 + rename」保证不会留下半个文件
// 不使用 flock：短命进程持锁崩溃会留下无法自动回收的死锁。

import fsp from 'node:fs/promises'
import { DEPRECATED_BELOW, GROUPS, ROOT, paths } from './config.mjs'
import { effectiveConfidence, normalizeGroup, readGroup, sortMemories } from './store.mjs'
import { ensureVectors, loadIndex } from './recall.mjs'

const REINFORCE_STEP = 0.1

// 分组的字面信号，用于交叉校验模型给出的 category。
// 规范/命令语气指向 rule，指称/陈述语气指向 project。
const RULE_MARKERS = [
  /不要|别再|不准|禁止|不许/,
  /必须|一律|始终|统一|务必/,
  /以后|今后|后续|下次|每次/,
  /应该|应当|建议|优先|需要/,
  /不超过|不大于|超过.{0,6}(应|需|要)/,
]
const PROJECT_MARKERS = [
  /链接为|文档为|地址为|参考该文档|见该文档/,
  /核心类|入口方法|接口|字段|参数名|开关为/,
  /PRD|iwiki|doc\.weixin|https?:\/\//,
  /返回|读取逻辑|去重机制|实现逻辑/,
]

// 由正文推断分组。返回 { group, confident }：
// confident=false 表示信号缺失，调用方应要求人工确认而非直接采信。
//
// 实测准确率 22/24（tools 里的历史评测）。两点设计依据：
// 1. 信号冲突时 project 优先——出现文档链接是「待查阅事实」的强证据，
//    只看规范语气会把「…后续可参考该文档」这类事实误判成规则（纠正前仅 16/24）。
// 2. 两种信号都缺失时偏向 rule——风险不对称：
//    漏判规则会让它静默失效且无从察觉；多判规则只是每轮多注入几百字符，
//    而 rule 每次会话都会出现在上下文里，标错了用户一眼就能看见。
export function inferGroup(text) {
  const t = String(text || '')
  const ruleHit = RULE_MARKERS.some((re) => re.test(t))
  const projectHit = PROJECT_MARKERS.some((re) => re.test(t))
  if (projectHit) return { group: 'project', confident: true }
  if (ruleHit) return { group: 'rule', confident: true }
  return { group: 'rule', confident: false }
}

async function writeAtomic(file, body) {
  const tmp = `${file}.tmp.${process.pid}`
  try {
    await fsp.mkdir(ROOT, { recursive: true })
    await fsp.writeFile(tmp, body, 'utf-8')
    await fsp.rename(tmp, file)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw new Error(`写入 ${file} 失败：${e.message}`)
  }
}

function newId() {
  return `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

// 新建记忆并落盘。category 必填，不设默认值——
// 它决定「每轮无条件注入」还是「按需召回」，静默默认会让项目事实污染每一轮上下文。
export async function persistMemory({ text, category, confidence = 0.6, evidence = '' }) {
  const clean = String(text || '').trim()
  if (!clean) throw new Error('记忆内容为空')
  const raw = String(category || '').trim().toLowerCase()
  if (!GROUPS.includes(raw)) {
    throw new Error(`category 必须是 ${GROUPS.join(' 或 ')}，收到「${category}」`)
  }
  const group = normalizeGroup(raw)

  const now = new Date().toISOString()
  const mem = {
    id: newId(),
    text: clean,
    confidence: Math.max(0.5, Number(confidence) || 0.5),
    category: group,
    evidence: String(evidence || ''),
    observations: 1,
    firstSeen: now,
    lastSeen: now,
    deprecated: false,
    createdAt: now,
  }

  await fsp.mkdir(ROOT, { recursive: true })
  await fsp.appendFile(paths.group(group), `${JSON.stringify(mem)}\n`, 'utf-8')

  // 立刻建向量，避免下一轮召回时这条记忆缺席。失败不影响落盘结果。
  try {
    await ensureVectors([mem], await loadIndex())
  } catch (e) {
    console.error(`[memory] 新记忆向量生成失败，将在下次召回时补建: ${e.message}`)
  }
  return mem
}

export async function findMemoryById(id) {
  for (const group of GROUPS) {
    const mems = await readGroup(group)
    const idx = mems.findIndex((m) => m.id === id)
    if (idx >= 0) return { group, mems, idx }
  }
  return null
}

// 强化已有记忆：置信度 +0.1（无上限）、观测次数 +1、刷新 lastSeen。
export async function reinforceMemory(id) {
  const found = await findMemoryById(id)
  if (!found) throw new Error(`未找到记忆 ${id}`)
  const mem = found.mems[found.idx]
  mem.confidence = (Number(mem.confidence) || 0.5) + REINFORCE_STEP
  mem.observations = (Number(mem.observations) || 0) + 1
  mem.lastSeen = new Date().toISOString()
  // 重新观测到说明它仍然有效，撤销此前的废弃标记。
  mem.deprecated = false
  const sorted = sortMemories(found.mems)
  await writeAtomic(paths.group(found.group), `${sorted.map((m) => JSON.stringify(m)).join('\n')}\n`)
  return mem
}

// 按时间衰减刷新废弃标记。只标记不删除，用户手动删除才是唯一真删除。
export async function refreshDeprecated() {
  const now = Date.now()
  let changed = 0
  for (const group of GROUPS) {
    const mems = await readGroup(group)
    if (mems.length === 0) continue
    let dirty = false
    for (const m of mems) {
      const shouldDeprecate = effectiveConfidence(m, now) < DEPRECATED_BELOW
      if (!!m.deprecated !== shouldDeprecate) {
        m.deprecated = shouldDeprecate
        dirty = true
        changed++
      }
    }
    if (dirty) {
      await writeAtomic(paths.group(group), `${sortMemories(mems).map((m) => JSON.stringify(m)).join('\n')}\n`)
    }
  }
  return changed
}
