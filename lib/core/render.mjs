// 渲染注入给模型的记忆文本。各宿主共用同一份渲染结果，保证行为一致。
//
// 两个注入时机：
//   sessionStart        —— rule 组全量注入，每会话一次
//   beforeSubmitPrompt  —— 按本轮输入向量召回 Top-K，每轮一次
//
// 为什么 rule 不能只靠召回：向量召回按语义相关性触发，覆盖不了「用户没提及但规则本该生效」
// 的情况。实测 4 组这类输入（如「帮我改一下这个函数的实现」对应「改完不要自动 commit」）
// 的最高分只有 0.118~0.243，与无关输入完全重叠——因为两者的关联是语用的而非语义的。
// 所以规则必须无条件注入，这不是召回质量问题，是机制上的边界。

import { READ_LIMIT } from './config.mjs'
import { fmtConfidence, readAllGroups, readAllMemories } from './store.mjs'
import { recall } from './recall.mjs'
import { loadSettings } from './settings.mjs'
import { countPendingCandidates } from './candidates.mjs'

// sessionStart：rule 全量 + project 概览 + 待确认候选提示。
export async function renderSessionStart() {
  const settings = await loadSettings()
  if (!settings.enabled) return ''

  const groups = await readAllGroups()
  const rules = groups.rule.filter((m) => !m.deprecated)
  const projects = groups.project.filter((m) => !m.deprecated)
  // 沉淀规则与记忆库是否为空无关。首次安装两组都是空的，仍要告诉主模型当前通路。

  const lines = []
  lines.push('# 长期记忆（自动生成，请勿手动编辑）')
  lines.push('')
  lines.push('你拥有跨会话的长期记忆，分两类：下列规则全程无条件生效；项目事实会在每轮输入时按相关性自动召回。')
  lines.push('')

  lines.push(`## 一、规则与偏好（共 ${rules.length} 条，必须遵守）`)
  lines.push('')
  if (rules.length === 0) {
    lines.push('（暂无）')
  } else {
    rules.slice(0, READ_LIMIT).forEach((m, i) => {
      lines.push(`${i + 1}. ${m.text}（置信度 ${fmtConfidence(m.confidence)}）`)
    })
    if (rules.length > READ_LIMIT) lines.push(`（其余 ${rules.length - READ_LIMIT} 条按置信度截断，可用 memory_read 查看）`)
  }
  lines.push('')

  lines.push(`## 二、项目事实（共 ${projects.length} 条）`)
  lines.push('')
  lines.push('相关条目会在每轮输入时自动召回，无需主动读取。若自动召回没给出你需要的内容，用 memory_read("project") 查看全部。')
  lines.push('')

  lines.push('## 三、沉淀规则')
  lines.push('')
  lines.push(...sedimentLines(settings))

  const pending = await countPendingCandidates()
  if (pending > 0) {
    lines.push('')
    lines.push('## 四、待确认候选')
    lines.push('')
    lines.push(`有 ${pending} 条从历史会话累积的候选记忆待处理，可用 memory_review 查看并确认。`)
  }

  return lines.join('\n')
}

// sideJudge 决定通路，confirm 只决定要不要弹确认。两条通路互斥。
function sedimentLines(settings) {
  const shared = [
    '- 一次性的任务细节、临时请求不要沉淀。',
    '- 记忆一律用中文书写，且正文必须自包含——不要写「那个文档的链接是…」这种脱离上下文就读不懂的内容，否则日后召不回来。',
  ]
  if (settings.sideJudge) {
    return [
      '- 当前为旁路模式：要不要记由后台判断。主模型没有 memory_propose。',
      ...shared,
      settings.confirm
        ? '- 当前需要确认：回答结束后若出现待确认记忆，按那条消息用宿主提问工具弹出确认（Cursor 用 AskQuestion，CodeBuddy 与 WorkBuddy 用 AskUserQuestion）。点选返回后上下文里会给出一次性 permit，再调用 memory_persist、memory_reinforce 或 memory_merge，并带上该 permit。没有 permit 的调用会被拒绝。'
        : '- 当前不需要确认：后台会直接写入。若出现结果通知，只把结果原样展示给用户，不要调用工具，不要提问。',
    ]
  }
  return [
    '- 当前为阻塞模式：当用户表达了可长期复用的偏好、规范、项目事实，或对同一件事做出第二次纠正时，调用 memory_propose 提交，不要等用户明说「记住」。',
    ...shared,
    settings.confirm
      ? '- 当前需要确认：memory_propose 返回最相近的两条记忆和判重提示。先判断新建、强化或合并，再用宿主提问工具弹出确认（Cursor 用 AskQuestion，CodeBuddy 与 WorkBuddy 用 AskUserQuestion）。用户点选后再调用 memory_persist、memory_reinforce 或 memory_merge。'
      : '- 当前不需要确认：分组判断明确时，按 memory_propose 的判重提示直接调用 memory_persist、memory_reinforce 或 memory_merge；分组信号缺失时仍用宿主提问工具确认。',
  ]
}

// 每轮 prompt：在全部记忆（rule + project）上召回。保留线是 max(绝对下限, top1×0.6)，再截到 Top-K。
// rule 虽已在 sessionStart 注入，但长会话的上下文压缩会把那份丢掉，
// 留在召回池里可在相关时被重新召回，等于自带补偿。
export async function renderRecall(promptTexts = []) {
  const settings = await loadSettings()
  if (!settings.enabled) return ''
  const texts = promptTexts.filter((t) => String(t || '').trim())
  if (texts.length === 0) return ''

  const pool = await readAllMemories()
  if (pool.length === 0) return ''

  let hits = []
  try {
    hits = await recall(texts, pool)
  } catch (e) {
    console.error(`[memory] 语义召回失败，本轮不注入: ${e.message}`)
    return ''
  }
  if (hits.length === 0) return ''

  const lines = []
  lines.push('# 与本轮输入相关的长期记忆（自动召回）')
  lines.push('')
  for (const h of hits) {
    lines.push(`- ${h.memory.text}（置信度 ${fmtConfidence(h.memory.confidence)}，相关度 ${h.score.toFixed(2)}）`)
  }
  lines.push('')
  lines.push('以上为系统按相关性自动召回，需遵守。')
  return lines.join('\n')
}
