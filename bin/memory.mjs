#!/usr/bin/env node
// 各宿主共用的记忆 CLI。Cursor / codebuddy 通过 hook 调用本入口拿注入文本，
// 人工也可直接用 list / read / rule 等子命令管理记忆库。
//
// 用法：
//   memory-self-evolution hook [--agent cursor|codebuddy]   从 stdin 读 hook 事件，按事件类型注入或收集候选
//   memory-self-evolution list                              列出两组记忆的条数
//   memory-self-evolution read <rule|project>               打印该组记忆
//   memory-self-evolution rule add "<规则>"                  直接新增一条规则，不经模型判断
//   memory-self-evolution config [key] [value]              查看或修改配置
//   memory-self-evolution review                            列出待确认候选
//
// hook 按事件分派：session-start 注入 rule 全量，prompt 注入 Top-K 召回，stop 收集候选。
//
// 风控约定：hook 模式下任何异常都输出空 JSON 并以 0 退出。
// 记忆功能失效可以接受，阻塞用户发送 prompt 不可接受。

import fsp from 'node:fs/promises'
import { GROUPS, READ_LIMIT } from '../lib/core/config.mjs'
import { fmtConfidence, readAllGroups, readGroup } from '../lib/core/store.mjs'
import { renderRecall, renderSessionStart } from '../lib/core/render.mjs'
import { collectCandidates, extractUserQueries, listCandidates } from '../lib/core/candidates.mjs'
import { persistMemory, refreshDeprecated } from '../lib/core/writer.mjs'
import { describeSettings, loadSettings, updateSetting } from '../lib/core/settings.mjs'

// Cursor 用 camelCase 事件名 + prompt 字段；codebuddy（Claude Code 系）用 PascalCase + user_prompt。
const CODEBUDDY_EVENTS = new Set(['UserPromptSubmit', 'SessionStart', 'Stop'])
const CURSOR_EVENTS = new Set(['beforeSubmitPrompt', 'sessionStart', 'stop'])

// 两端事件名归一成语义相同的三类。
const EVENT_KIND = {
  sessionStart: 'session-start',
  SessionStart: 'session-start',
  beforeSubmitPrompt: 'prompt',
  UserPromptSubmit: 'prompt',
  stop: 'stop',
  Stop: 'stop',
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = ''
    if (process.stdin.isTTY) return resolve('')
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (c) => (buf += c))
    process.stdin.on('end', () => resolve(buf))
    process.stdin.on('error', (e) => {
      console.error(`[memory] 读取 hook 输入失败: ${e.message}`)
      resolve('')
    })
  })
}

function detectAgent(argv, event) {
  const flagIdx = argv.indexOf('--agent')
  if (flagIdx >= 0 && argv[flagIdx + 1]) return argv[flagIdx + 1]
  if (CODEBUDDY_EVENTS.has(event)) return 'codebuddy'
  if (CURSOR_EVENTS.has(event)) return 'cursor'
  return 'cursor'
}

// 不同宿主的注入字段名不同，统一在这里转换。
function wrapInjection(agent, event, text) {
  if (!text) return {}
  if (agent === 'codebuddy') {
    return {
      hookSpecificOutput: {
        hookEventName: event || 'UserPromptSubmit',
        additionalContext: text,
      },
    }
  }
  return { additional_context: text }
}

// stop 事件：读 transcript 收集候选。不注入任何内容，输出空对象。
async function handleStop(payload) {
  const settings = await loadSettings()
  if (!settings.enabled) return

  // 顺手刷新废弃标记：置信度衰减是时间驱动的，需要有个定期触发点。
  try {
    const changed = await refreshDeprecated()
    if (changed > 0) console.error(`[memory] 刷新废弃标记，${changed} 条状态变更`)
  } catch (e) {
    console.error(`[memory] 刷新废弃标记失败: ${e.message}`)
  }

  const file = String(payload.transcript_path || '').trim()
  if (!file) {
    console.error('[memory] stop 事件未提供 transcript_path，跳过候选收集')
    return
  }
  let content
  try {
    content = await fsp.readFile(file, 'utf-8')
  } catch (e) {
    console.error(`[memory] 读取 transcript 失败，跳过候选收集: ${e.message}`)
    return
  }
  const queries = extractUserQueries(content)
  if (queries.length === 0) return
  const r = await collectCandidates(queries, String(payload.session_id || ''))
  if (r.added || r.reinforced) {
    console.error(`[memory] 候选池更新：新增 ${r.added} 条，强化 ${r.reinforced} 条`)
  }
}

async function runHook(argv) {
  const raw = await readStdin()
  let payload = {}
  if (raw.trim()) {
    try {
      payload = JSON.parse(raw)
    } catch (e) {
      console.error(`[memory] hook 输入不是合法 JSON，按空输入处理: ${e.message}`)
    }
  }
  const event = String(payload.hook_event_name || '')
  const agent = detectAgent(argv, event)
  const kind = EVENT_KIND[event] || (argv.includes('--session-start') ? 'session-start' : 'prompt')

  if (kind === 'stop') {
    await handleStop(payload)
    process.stdout.write('{}')
    return
  }

  const text = kind === 'session-start'
    ? await renderSessionStart()
    : await renderRecall([String(payload.prompt || payload.user_prompt || '').trim()])

  process.stdout.write(JSON.stringify(wrapInjection(agent, event, text), null, 0))
}

async function runList() {
  const groups = await readAllGroups()
  const total = GROUPS.reduce((n, g) => n + groups[g].length, 0)
  if (total === 0) {
    console.log('记忆库为空')
    return
  }
  console.log(`rule    ${groups.rule.length} 条（会话开始全量注入，无条件生效）`)
  console.log(`project ${groups.project.length} 条（按相关性自动召回）`)
  console.log(`共 ${total} 条`)
}

async function runRead(group) {
  if (!GROUPS.includes(group)) {
    console.error(`用法：memory-self-evolution read <${GROUPS.join('|')}>`)
    process.exitCode = 1
    return
  }
  const mems = await readGroup(group)
  if (mems.length === 0) {
    console.log(`「${group}」下没有记忆`)
    return
  }
  console.log(`${group}（共 ${mems.length} 条${mems.length > READ_LIMIT ? `，显示前 ${READ_LIMIT}` : ''}）`)
  mems.slice(0, READ_LIMIT).forEach((m, i) => {
    const dep = m.deprecated ? '[已废弃] ' : ''
    console.log(`${i + 1}. ${dep}${m.text}（置信度 ${fmtConfidence(m.confidence)}，id ${m.id}）`)
  })
}

// 直接新增规则，不经模型判断——用户说了就是规则。
async function runRuleAdd(text) {
  if (!text) {
    console.error('用法：memory-self-evolution rule add "<规则内容>"')
    process.exitCode = 1
    return
  }
  const mem = await persistMemory({ text, category: 'rule', confidence: 0.9, evidence: '用户通过 CLI 直接添加' })
  console.log(`已新增规则：${mem.text}`)
  console.log(`置信度 ${fmtConfidence(mem.confidence)}，id ${mem.id}`)
  console.log('下个会话开始起无条件生效。')
}

async function runConfig(key, value) {
  if (!key) {
    const items = await describeSettings()
    for (const i of items) console.log(`${i.key.padEnd(16)} = ${i.value}${i.isDefault ? '  (默认)' : ''}`)
    return
  }
  if (value === undefined) {
    console.error('用法：memory-self-evolution config <key> <value>')
    process.exitCode = 1
    return
  }
  const r = await updateSetting(key, value)
  console.log(r.message)
  if (!r.ok) process.exitCode = 1
}

async function runReview() {
  const items = await listCandidates()
  if (items.length === 0) {
    console.log('没有待确认的候选记忆')
    return
  }
  console.log(`${items.length} 条待确认候选（按出现次数降序）：`)
  items.forEach((c, i) => {
    console.log(`${i + 1}. ${c.text}`)
    console.log(`   出现 ${c.observations} 次，最近 ${String(c.lastSeen).slice(0, 10)}，指纹 ${c.fingerprint}`)
  })
}

const argv = process.argv.slice(2)
const cmd = argv[0]

try {
  if (cmd === 'hook') {
    await runHook(argv)
  } else if (cmd === 'list') {
    await runList()
  } else if (cmd === 'read') {
    await runRead(argv[1])
  } else if (cmd === 'rule' && argv[1] === 'add') {
    await runRuleAdd(argv.slice(2).join(' ').trim())
  } else if (cmd === 'config') {
    await runConfig(argv[1], argv[2])
  } else if (cmd === 'review') {
    await runReview()
  } else {
    console.error('用法：memory-self-evolution <hook|list|read|rule add|config|review> [参数]')
    process.exitCode = 1
  }
} catch (e) {
  if (cmd === 'hook') {
    // hook 失败必须静默降级，否则会阻断用户发送 prompt。
    console.error(`[memory] hook 执行失败，本轮不注入记忆: ${e.stack || e.message}`)
    process.stdout.write('{}')
  } else {
    console.error(`[memory] 执行失败: ${e.stack || e.message}`)
    process.exitCode = 1
  }
}
