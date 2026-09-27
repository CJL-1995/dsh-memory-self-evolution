// 用户可调配置，落在 ~/.memory-self-evolution/config.json。
// 缺文件、缺字段、字段类型不对都回退到默认值，保证配置写坏了也不影响记忆可用。

import fsp from 'node:fs/promises'
import path from 'node:path'
import { ROOT, paths } from './config.mjs'

const CONFIG_FILE = paths.config

export const DEFAULTS = {
  // 关掉后 hook 不再注入任何记忆，MCP 工具也只读不写。
  enabled: true,
  // 每轮召回条数上限。注意它是上限而非配额：门控不过就一条都不注入。
  recallTopK: 10,
  // 相关性下限。任一项设为 -1 即关闭该项检查，两项都关则退化为纯 Top-K。
  //
  // 取 0.22 的依据（16 条相关 + 11 条无关输入实测，见 tools/verify-gate.mjs）：
  //   相关输入 top1  0.160 ~ 0.567   无关输入 top1  0.089 ~ 0.285，重叠区 0.160~0.285
  //   0.22 -> 相关召回 14/16，总误放行 2/11，其中含 project 的 0/11
  //   0.30 -> 相关召回 12/16，总误放行 0/11
  // 关键在于误放行的代价不对称：被误召回的两条都是 rule，而 rule 在会话开始已无条件注入过，
  // 重复出现一次几乎零成本；真正会污染上下文的是 project 被无关输入拉进来，实测在所有阈值下都是 0。
  // 所以这里偏向召回。若 project 组显著增长，需要重跑 verify-gate 重新标定。
  recallMinScore: 0.22,
  // 领先幅度门控默认关闭，原因见 config.mjs 的说明：多条同时相关时会误拒。
  recallMinMargin: -1,
  // 沉淀前是否需要用户确认。关闭后仅在「模型判断与字面信号分歧」时才追问。
  confirm: true,
}

const SCHEMA = {
  enabled: 'boolean',
  recallTopK: 'number',
  recallMinScore: 'number',
  recallMinMargin: 'number',
  confirm: 'boolean',
}

let cache = null

export async function loadSettings() {
  if (cache) return cache
  const out = { ...DEFAULTS }
  let raw = null
  try {
    raw = await fsp.readFile(CONFIG_FILE, 'utf-8')
  } catch (e) {
    // 首次运行没有配置文件是正常的，直接用默认值。
    if (e.code !== 'ENOENT') console.error(`[memory] 读取配置失败，改用默认值: ${e.message}`)
    cache = out
    return out
  }
  try {
    const parsed = JSON.parse(raw)
    for (const [key, type] of Object.entries(SCHEMA)) {
      if (parsed[key] === undefined) continue
      if (typeof parsed[key] !== type) {
        console.error(`[memory] 配置项 ${key} 类型应为 ${type}，已忽略`)
        continue
      }
      out[key] = parsed[key]
    }
  } catch (e) {
    console.error(`[memory] config.json 解析失败，改用默认值: ${e.message}`)
  }
  cache = out
  return out
}

// 返回 { ok, message }，由调用方决定怎么呈现给用户。
export async function updateSetting(key, rawValue) {
  const type = SCHEMA[key]
  if (!type) return { ok: false, message: `未知配置项「${key}」，可用：${Object.keys(SCHEMA).join('、')}` }

  let value = rawValue
  if (type === 'number') {
    value = Number(rawValue)
    if (!Number.isFinite(value)) return { ok: false, message: `${key} 需要数字，收到「${rawValue}」` }
  } else if (type === 'boolean') {
    const s = String(rawValue).toLowerCase()
    if (!['true', 'false', 'on', 'off', '1', '0'].includes(s)) {
      return { ok: false, message: `${key} 需要 true/false，收到「${rawValue}」` }
    }
    value = ['true', 'on', '1'].includes(s)
  } else {
    value = String(rawValue)
  }

  const current = await loadSettings()
  const next = { ...current, [key]: value }
  const tmp = `${CONFIG_FILE}.tmp.${process.pid}`
  try {
    await fsp.mkdir(ROOT, { recursive: true })
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
    await fsp.rename(tmp, CONFIG_FILE)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    return { ok: false, message: `写入配置失败：${e.message}` }
  }
  cache = next
  return { ok: true, message: `${key} 已设为 ${value}` }
}

export async function describeSettings() {
  const s = await loadSettings()
  return Object.entries(SCHEMA).map(([key]) => ({
    key,
    value: s[key],
    isDefault: s[key] === DEFAULTS[key],
  }))
}
