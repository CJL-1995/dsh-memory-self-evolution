#!/usr/bin/env node
// 召回与门控的回归基线。测的是「该不该注入、注入得对不对」这个决策。
//
// 标注方式：每条输入标一个「期望命中的记忆正文片段」。标签概念已移除，
// 所以不再用标签做弱标签，直接按正文匹配，判定更严格也更贴近实际效果。
//
// 阈值不是常数，它是「模型 × 编码方式 × 记忆池」的函数。
// 换模型、改编码、记忆池构成变化后都必须重跑本脚本重新标定。
//
// 相关输入依赖各自的记忆池，放在 ~/.memory-self-evolution/verify-cases.json，不随仓库分发：
//   { "relevant": [["用户口吻的输入", "期望命中的记忆正文片段"]], "irrelevant": ["..."], "minHit": 14 }
// irrelevant 可省略，省略时使用下方的通用无关输入；minHit 省略时要求相关输入全部命中。
//
// 用法：node tools/verify-gate.mjs

import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../lib/core/config.mjs'
import { readAllMemories } from '../lib/core/store.mjs'
import { recall } from '../lib/core/recall.mjs'

const CASES_FILE = path.join(ROOT, 'verify-cases.json')

function loadCases() {
  let data
  try {
    data = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'))
  } catch (e) {
    console.error(`读取用例文件失败 ${CASES_FILE}: ${e.message}`)
    console.error('请按脚本头部注释的格式，用自己记忆库里的内容编写相关输入。')
    return null
  }
  const valid = Array.isArray(data?.relevant) && data.relevant.length > 0
    && data.relevant.every((item) => Array.isArray(item) && item.length === 2 && item.every((s) => typeof s === 'string' && s.trim()))
  if (!valid) {
    console.error(`用例文件 ${CASES_FILE} 的 relevant 必须是非空的 [输入, 期望片段] 数组`)
    return null
  }
  return data
}

// 与记忆库任何内容都不相干，门控必须全部挡住
const DEFAULT_IRRELEVANT = [
  '帮我把这个 JSON 格式化一下',
  '今天天气怎么样',
  '把这段文字翻译成英文',
  '解释一下快速排序的原理',
  '帮我写个正则匹配邮箱',
  '这个按钮点了没反应',
  '帮我重命名这个变量',
  '这个报错是什么意思',
  '跑一下测试',
  '帮我看下这个文件',
  '这个方法怎么用',
]

const cases = loadCases()
if (!cases) {
  process.exitCode = 1
  process.exit()
}
const RELEVANT = cases.relevant
const IRRELEVANT = Array.isArray(cases.irrelevant) && cases.irrelevant.length > 0 ? cases.irrelevant : DEFAULT_IRRELEVANT

const pool = await readAllMemories()
console.log(`召回池 ${pool.length} 条，相关输入 ${RELEVANT.length} 条，无关输入 ${IRRELEVANT.length} 条\n`)

let hit = 0
const misses = []
for (const [q, expect] of RELEVANT) {
  const hits = await recall([q], pool)
  if (hits.some((h) => h.memory.text.includes(expect))) hit++
  else {
    const raw = await recall([q], pool, { gate: false, topK: 1 })
    misses.push({ q, expect, top1: raw[0] ? `${raw[0].score.toFixed(3)} ${raw[0].memory.text.slice(0, 24)}` : '无' })
  }
}

// 误放行分两种，代价差别很大：
//   命中 rule —— rule 在会话开始已无条件注入，重复出现一次几乎零成本，可容忍
//   命中 project —— 往上下文里塞进本轮完全不需要的项目事实，这才是真污染
let leak = 0
let harmful = 0
const leaks = []
for (const q of IRRELEVANT) {
  const hits = await recall([q], pool)
  if (hits.length === 0) continue
  leak++
  const hasProject = hits.some((h) => h.memory.category === 'project')
  if (hasProject) harmful++
  leaks.push({ q, hasProject, got: `[${hits[0].memory.category}] ${hits[0].score.toFixed(3)} ${hits[0].memory.text.slice(0, 24)}` })
}

console.log(`相关输入正确召回：${hit}/${RELEVANT.length}`)
console.log(`无关输入误放行：  ${leak}/${IRRELEVANT.length}（其中含 project 的 ${harmful} 条为真污染）`)

if (misses.length) {
  console.log('\n未召回的相关输入：')
  for (const m of misses) console.log(`  「${m.q}」期望含「${m.expect}」-> top1 ${m.top1}`)
}
if (leaks.length) {
  console.log('\n误放行的无关输入：')
  for (const l of leaks) console.log(`  ${l.hasProject ? '[真污染]' : '[可容忍]'} 「${l.q}」-> ${l.got}`)
}

// 下限随记忆池变化：中心化的语料均值依赖池子构成，增删记忆会让所有分数平移，
// 所以这个数字是「当前池子下的已知可达值」，不是恒定目标。调整前先看清失败项是真退步还是池子变了。
const MIN_HIT = Number.isInteger(cases.minHit) ? cases.minHit : RELEVANT.length
const MAX_HARMFUL = 0
let failed = false
if (harmful > MAX_HARMFUL) {
  console.error(`\n校验失败：${harmful} 条无关输入拉进了 project 记忆，超过上限 ${MAX_HARMFUL}`)
  failed = true
}
if (hit < MIN_HIT) {
  console.error(`\n校验失败：正确召回 ${hit} 低于下限 ${MIN_HIT}`)
  failed = true
}
// 用 exitCode 而非 process.exit()：后者会在 onnxruntime 线程还活着时强行退出，
// 触发 "mutex lock failed" 的 abort，把真正的失败原因淹没在崩溃栈里。
process.exitCode = failed ? 1 : 0
console.log(failed ? '' : '\n校验通过')
