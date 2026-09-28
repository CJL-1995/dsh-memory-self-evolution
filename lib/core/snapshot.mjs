// 把 rule / project 渲染成一份给人核对的 Markdown。
// 每次新增、合并、强化后整份覆盖，避免和 jsonl 对不上。写失败只记日志，不挡住记忆落盘。

import fsp from 'node:fs/promises'
import { ROOT, paths } from './config.mjs'
import { fmtConfidence, readAllGroups } from './store.mjs'

const TITLES = {
  rule: '规则与偏好',
  project: '项目事实',
}

function stamp() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false }).replace('T', ' ')
}

function section(group, mems) {
  const title = TITLES[group] || group
  const lines = [`## ${title}（${mems.length}）`, '']
  if (mems.length === 0) {
    lines.push('（空）', '')
    return lines
  }
  mems.forEach((mem, index) => {
    const flags = [mem.deprecated ? '已废弃' : ''].filter(Boolean)
    const meta = [
      `置信度 ${fmtConfidence(mem.confidence)}`,
      `观测 ${Number(mem.observations) || 0}`,
      `id \`${mem.id}\``,
      ...flags,
    ].join('，')
    lines.push(`${index + 1}. ${mem.text}`)
    lines.push(`   - ${meta}`)
    lines.push('')
  })
  return lines
}

export function renderSnapshot(groups) {
  const rule = groups.rule || []
  const project = groups.project || []
  return [
    '# 记忆快照',
    '',
    `更新于 ${stamp()}（北京时间）。本文件由写入自动覆盖，请不要手改。`,
    '',
    ...section('rule', rule),
    ...section('project', project),
  ].join('\n')
}

export async function syncSnapshot() {
  try {
    const groups = await readAllGroups()
    const body = renderSnapshot(groups)
    const tmp = `${paths.snapshot}.tmp.${process.pid}`
    await fsp.mkdir(ROOT, { recursive: true })
    await fsp.writeFile(tmp, body, 'utf-8')
    await fsp.rename(tmp, paths.snapshot)
  } catch (e) {
    console.error(`[memory] 同步记忆快照失败: ${e.message}`)
  }
}
