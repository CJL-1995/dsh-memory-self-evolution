#!/usr/bin/env node
// 三端共用的记忆 MCP server（stdio，JSON-RPC 2.0，换行分隔）。
// Cursor 与 codebuddy 的 mcp.json 格式一致，同一份配置两端复用。
// 手写协议而不引依赖：这个 server 要被短命/常驻两种方式反复启动，依赖越少启动越快、越不易坏。

import { GROUPS, READ_LIMIT } from '../lib/core/config.mjs'
import { fmtConfidence, readAllGroups, readAllMemories, readGroup } from '../lib/core/store.mjs'
import { recall } from '../lib/core/recall.mjs'
import { inferGroup, persistMemory, reinforceMemory } from '../lib/core/writer.mjs'
import { dropCandidate, listCandidates } from '../lib/core/candidates.mjs'
import { describeSettings, loadSettings, updateSetting } from '../lib/core/settings.mjs'

const PROTOCOL_VERSION = '2024-11-05'

const TOOLS = [
  {
    name: 'memory_list',
    description: '列出两组记忆的条数。rule 是无条件生效的规则与偏好，project 是按需召回的项目事实。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'memory_read',
    description: `读取某一组的全部记忆，按置信度降序。超过 ${READ_LIMIT} 条时返回前 ${READ_LIMIT} 条并注明总量。每轮的自动召回若没给出你需要的内容，再调用它兜底。`,
    inputSchema: {
      type: 'object',
      properties: { group: { type: 'string', enum: GROUPS, description: 'rule=规则与偏好，project=项目事实' } },
      required: ['group'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_propose',
    description:
      '提交一条值得长期记住的记忆（用户的偏好、规范、项目事实，或对同一件事的第二次纠正）。本工具不直接落盘：它返回语义相近的已有记忆、分组建议，以及要交给宿主提问工具的题面和选项。确认模式下必须调用宿主应用内提问工具（Cursor 用 AskQuestion，CodeBuddy 用 AskUserQuestion），禁止在对话里写草稿，禁止使用系统弹窗。一次性任务细节不要提交。正文必须自包含，脱离当前上下文也能读懂。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '一句清晰、可执行、自包含的中文陈述' },
        evidence: { type: 'string', description: '简短佐证，说明用户在哪句话里表达了它' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_persist',
    description: '把记忆正式写入。仅在 memory_propose 之后、且（确认模式下）用户已确认时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '记忆正文，中文，须自包含' },
        category: {
          type: 'string',
          enum: GROUPS,
          description: 'rule=无条件遵守的偏好与规范，每轮都会注入；project=需要时才查阅的项目事实，靠相关性召回。拿不准时选 rule：漏判规则会让它静默失效，多判只是多占一点上下文。',
        },
        evidence: { type: 'string' },
        confidence: { type: 'number', description: '用户表达的明确程度 0~1，越明确越高，下限按 0.5 处理' },
      },
      required: ['text', 'category'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_reinforce',
    description: '强化一条已有记忆（置信度 +0.1、观测次数 +1）。当用户重复表达了已存在的记忆时调用，而不要新建重复条目。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'memory_propose 或 memory_read 返回的记忆 id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_review',
    description: '列出从历史会话累积的待确认候选记忆（按出现次数降序）。用户说要处理候选、或会话开始提示有待确认候选时调用。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'memory_discard',
    description: '丢弃一条候选记忆。reject 为 true 时在 30 天内不再就同一内容提问。',
    inputSchema: {
      type: 'object',
      properties: {
        fingerprint: { type: 'string', description: 'memory_review 返回的候选指纹' },
        reject: { type: 'boolean', description: '是否同时加入拒绝名单' },
      },
      required: ['fingerprint'],
      additionalProperties: false,
    },
  },
  {
    name: 'memory_config',
    description: '查看或修改记忆系统配置。不传参数即查看全部；传 key 与 value 则修改。可调项含 recallTopK（每轮召回条数上限）、recallMinScore / recallMinMargin（相关性门控，-1 为关闭）、confirm（沉淀是否需确认）、enabled。',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
]

const text = (s) => ({ content: [{ type: 'text', text: s }] })

// 与 memoryPropose 里的判重说明一致：0.44 以上视为同一条。
const SAME_MEMORY_SCORE = 0.44

function otherGroup(group) {
  return group === 'rule' ? 'project' : 'rule'
}

function hostQuestionGuide(prompt, options) {
  const optionLines = options.map((label) => `- ${label}`).join('\n')
  return [
    '下一步必须调用当前宿主的应用内提问工具，由它弹出确认。禁止在对话里写草稿或列表，禁止使用系统弹窗。',
    'Cursor 用 AskQuestion，CodeBuddy 用 AskUserQuestion。题面和选项照抄，不要改写。',
    '',
    `题面：${prompt}`,
    '选项：',
    optionLines,
    '',
    '用户点选之后再调用 memory_persist 或 memory_reinforce。选「不落成」则不要写盘。',
  ].join('\n')
}

async function memoryList() {
  const groups = await readAllGroups()
  const total = GROUPS.reduce((n, g) => n + groups[g].length, 0)
  if (total === 0) return text('记忆库为空')
  return text(
    [
      `rule    ${groups.rule.length} 条 —— 无条件生效的规则与偏好，会话开始已全量注入，无需读取`,
      `project ${groups.project.length} 条 —— 项目事实，相关条目每轮自动召回；需要全量时用 memory_read("project")`,
    ].join('\n')
  )
}

async function memoryRead(args) {
  const group = String(args.group || '').trim().toLowerCase()
  if (!GROUPS.includes(group)) return text(`参数 group 必须是 ${GROUPS.join(' 或 ')}`)
  const mems = await readGroup(group)
  if (mems.length === 0) return text(`「${group}」下没有记忆`)
  const head = `${group}（共 ${mems.length} 条${mems.length > READ_LIMIT ? `，以下为前 ${READ_LIMIT} 条` : ''}）`
  const body = mems
    .slice(0, READ_LIMIT)
    .map((m, i) => `${i + 1}. ${m.deprecated ? '[已废弃] ' : ''}${m.text}（置信度 ${fmtConfidence(m.confidence)}，id ${m.id}）`)
    .join('\n')
  return text(`${head}\n${body}`)
}

async function memoryPropose(args) {
  const content = String(args.text || '').trim()
  if (!content) return text('参数 text 不能为空')

  const settings = await loadSettings()
  const all = await readAllMemories()
  // 关掉门控拿原始排序：这里要的是「最像的几条」供模型判重，不是「够不够相关」。
  // 判重与召回用的是同一份纯正文向量，两侧对称，分数可直接按阈值解读。
  let similar = []
  try {
    similar = await recall([content], all, { topK: 5, gate: false })
  } catch (e) {
    console.error(`[memory] 判重召回失败，跳过相近记忆提示: ${e.message}`)
  }

  const lines = [`待沉淀内容：${content}`]
  if (similar.length > 0) {
    lines.push('', '语义相近的已有记忆（若表达的是同一条规则，请调 memory_reinforce 而非新建）：')
    for (const s of similar) {
      lines.push(`- [${s.memory.category}] ${s.memory.text}（相似度 ${s.score.toFixed(2)}，id ${s.memory.id}）`)
    }
    // 实测真重复的相似度不低于 0.44、真新记忆不高于 0.34，中间有明确空隙
    lines.push('', '参考：相似度 0.44 以上大概率是同一条，0.34 以下大概率是新记忆，中间需要你自己判断。')
  } else {
    lines.push('', '没有语义相近的已有记忆。')
  }

  const guess = inferGroup(content)
  const groupNote = guess.confident ? '正文的语气信号明确' : '正文没有明确信号，这是保守默认值'
  lines.push('', `分组建议：${guess.group}（${groupNote}）`)

  const top = similar[0]
  const duplicate = top && top.score >= SAME_MEMORY_SCORE ? top : null
  if (!settings.confirm && guess.confident && !duplicate) {
    lines.push('当前为免确认模式且分组信号明确：可直接调用 memory_persist 或 memory_reinforce。')
    return text(lines.join('\n'))
  }

  const alt = otherGroup(guess.group)
  if (duplicate) {
    lines.push('', hostQuestionGuide(
      `检测到一条记忆，与已有条目很像（id ${duplicate.memory.id}）。是否落成记忆。\n正文：${content}\n推荐：强化已有记忆`,
      [
        `强化已有记忆 ${duplicate.memory.id}`,
        `仍新建，使用推荐标签 ${guess.group}`,
        `仍新建，把标签改为 ${alt}`,
        '不落成',
      ],
    ))
    return text(lines.join('\n'))
  }

  lines.push('', hostQuestionGuide(
    `检测到一条记忆，建议落成 ${guess.group}。是否落成记忆。\n正文：${content}\n推荐标签：${guess.group}`,
    [
      `落成，使用推荐标签 ${guess.group}`,
      `落成，把标签改为 ${alt}`,
      '不落成',
    ],
  ))
  return text(lines.join('\n'))
}

async function memoryPersist(args) {
  const mem = await persistMemory({
    text: args.text,
    category: args.category,
    evidence: args.evidence,
    confidence: args.confidence,
  })
  const note = mem.category === 'rule' ? '下个会话开始起无条件注入' : '将按相关性自动召回'
  return text(`已沉淀为 ${mem.category}：${mem.text}（置信度 ${fmtConfidence(mem.confidence)}，id ${mem.id}）。${note}。`)
}

async function memoryReinforce(args) {
  const mem = await reinforceMemory(String(args.id || '').trim())
  return text(`已强化 ${mem.category} 中的记忆：${mem.text}（置信度 ${fmtConfidence(mem.confidence)}，观测 ${mem.observations} 次）`)
}

async function memoryReview() {
  const items = await listCandidates()
  if (items.length === 0) return text('没有待确认的候选记忆')
  const body = items
    .map((c, i) => `${i + 1}. ${c.text}\n   出现 ${c.observations} 次，最近 ${String(c.lastSeen).slice(0, 10)}，指纹 ${c.fingerprint}`)
    .join('\n')
  return text(
    `${items.length} 条待确认候选（按出现次数降序）：\n${body}\n\n请整理成编号列表询问用户：沉淀哪些、归到哪个标签、哪些丢弃。确认后对沉淀项调 memory_persist，对丢弃项调 memory_discard。`
  )
}

async function memoryDiscard(args) {
  const ok = await dropCandidate(String(args.fingerprint || '').trim(), { reject: !!args.reject })
  return text(ok ? '候选已丢弃' : '未找到该候选，可能已被处理')
}

async function memoryConfig(args) {
  if (!args.key) {
    const items = await describeSettings()
    const body = items.map((i) => `- ${i.key} = ${i.value}${i.isDefault ? '（默认）' : ''}`).join('\n')
    return text(`当前配置：\n${body}`)
  }
  if (args.value === undefined) return text('修改配置需要同时提供 key 与 value')
  const r = await updateSetting(args.key, args.value)
  return text(r.message)
}

const HANDLERS = {
  memory_list: memoryList,
  memory_read: memoryRead,
  memory_propose: memoryPropose,
  memory_persist: memoryPersist,
  memory_reinforce: memoryReinforce,
  memory_review: memoryReview,
  memory_discard: memoryDiscard,
  memory_config: memoryConfig,
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`)
}

async function handle(req) {
  const { id, method, params } = req
  if (method === 'initialize') {
    return {
      protocolVersion: (params && params.protocolVersion) || PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'memory-self-evolution', version: '0.2.0' },
    }
  }
  if (method === 'tools/list') return { tools: TOOLS }
  if (method === 'tools/call') {
    const name = params && params.name
    const handler = HANDLERS[name]
    if (!handler) throw new Error(`未知工具「${name}」`)
    return await handler((params && params.arguments) || {})
  }
  if (method === 'ping') return {}
  throw new Error(`不支持的方法「${method}」`)
}

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', async (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let req
    try {
      req = JSON.parse(line)
    } catch (e) {
      console.error(`[memory-mcp] 收到非法 JSON，已忽略: ${e.message}`)
      continue
    }
    // 通知类消息（无 id）不需要回复。
    if (req.id === undefined || req.id === null) continue
    try {
      send({ jsonrpc: '2.0', id: req.id, result: await handle(req) })
    } catch (e) {
      // 工具执行失败要以 isError 形式回给模型，让它能看到原因并自行调整，
      // 而不是抛协议级错误让整个 server 看起来坏掉。
      const isToolCall = req.method === 'tools/call'
      if (isToolCall) {
        send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `执行失败：${e.message}` }], isError: true } })
      } else {
        send({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: e.message } })
      }
      console.error(`[memory-mcp] ${req.method} 失败: ${e.stack || e.message}`)
    }
  }
})
