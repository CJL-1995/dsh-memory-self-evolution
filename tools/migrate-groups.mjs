#!/usr/bin/env node
// 把早期「按自由标签分文件」的记忆迁移成「按 rule / project 两组分文件」。
//
// 映射规则：category=project 归 project，其余（rule / preference / 缺失）归 rule。
// preference 与 rule 的界线在历史数据里本就模糊——「嵌套不超过 3 层」标成 rule、
// 「不超过 80 行」标成 preference，两条同类规范被分到两边，没有实质区别，故合并。
//
// 原标签写入 sourceTag 保留溯源，不丢信息、可回退。
// 用法：node tools/migrate-groups.mjs [--dry]

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { GROUPS, ROOT, paths } from '../lib/core/config.mjs'

const dry = process.argv.includes('--dry')

const legacyFiles = fs
  .readdirSync(ROOT)
  .filter((n) => n.endsWith('.jsonl') && n !== 'embeddings.jsonl' && !GROUPS.includes(n.slice(0, -6)))

if (legacyFiles.length === 0) {
  console.log('没有找到需要迁移的旧标签文件')
  process.exit(0)
}

const buckets = { rule: [], project: [] }
let skipped = 0
for (const name of legacyFiles) {
  const sourceTag = name.slice(0, -6)
  for (const line of fs.readFileSync(path.join(ROOT, name), 'utf-8').split('\n')) {
    if (!line.trim()) continue
    let rec
    try {
      rec = JSON.parse(line)
    } catch (e) {
      skipped++
      console.error(`跳过无法解析的行（${name}）: ${e.message}`)
      continue
    }
    if (!rec || !rec.text) {
      skipped++
      continue
    }
    const group = rec.category === 'project' ? 'project' : 'rule'
    const { tag, ...rest } = rec
    buckets[group].push({ ...rest, category: group, sourceTag: tag || sourceTag })
  }
}

console.log(`旧文件 ${legacyFiles.length} 个，解析出 rule ${buckets.rule.length} 条、project ${buckets.project.length} 条${skipped ? `，跳过 ${skipped} 条` : ''}`)
console.log('\nrule（会话开始全量注入）：')
for (const m of buckets.rule) console.log(`  [${String(m.confidence).padEnd(4)}] ${m.text.slice(0, 46)}   ←${m.sourceTag}`)
console.log('\nproject（向量召回）：')
for (const m of buckets.project) console.log(`  [${String(m.confidence).padEnd(4)}] ${m.text.slice(0, 46)}   ←${m.sourceTag}`)

if (dry) {
  console.log('\n--dry 模式，未写入任何文件')
  process.exit(0)
}

for (const g of GROUPS) {
  const body = buckets[g].map((m) => JSON.stringify(m)).join('\n')
  const tmp = `${paths.group(g)}.tmp.${process.pid}`
  await fsp.writeFile(tmp, buckets[g].length ? `${body}\n` : '', 'utf-8')
  await fsp.rename(tmp, paths.group(g))
  console.log(`\n已写入 ${path.basename(paths.group(g))}：${buckets[g].length} 条`)
}

// 旧文件改名而非删除，确认无误后可手动清理
const archive = path.join(ROOT, `legacy-tags.${Date.now()}`)
await fsp.mkdir(archive, { recursive: true })
for (const name of legacyFiles) {
  await fsp.rename(path.join(ROOT, name), path.join(archive, name))
}
console.log(`\n旧标签文件已移入 ${path.basename(archive)}/（未删除）`)

// 编码方式变了（去掉标签前缀），旧向量必须作废
await fsp.rm(paths.embeddings, { force: true })
console.log('已清除旧向量索引，需运行 tools/rebuild-index.mjs 重建')
