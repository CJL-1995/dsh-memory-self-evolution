#!/usr/bin/env node
// 召回与门控的回归基线。测的是「该不该注入、注入得对不对」这个决策。
//
// 标注方式：每条输入标一个「期望命中的记忆正文片段」。标签概念已移除，
// 所以不再用标签做弱标签，直接按正文匹配，判定更严格也更贴近实际效果。
//
// 阈值不是常数，它是「模型 × 编码方式 × 记忆池」的函数。
// 换模型、改编码、记忆池构成变化后都必须重跑本脚本重新标定。
//
// 用法：node tools/verify-gate.mjs

import { readAllMemories } from '../lib/core/store.mjs'
import { recall } from '../lib/core/recall.mjs'

// [用户口吻的输入, 期望命中的记忆正文片段]
const RELEVANT = [
  ['为什么 imageSug 接口没有发请求', '三重去重机制'],
  ['端模型的 demo 在哪里能看到', 'client_model'],
  ['拍照选图那个提示文案是哪里来的', 'staticHint'],
  ['导出成 word 和 pdf 的需求文档在哪', '多格式导出'],
  ['导航栏那个毛玻璃效果深色模式要注意什么', '高斯模糊'],
  ['液态玻璃踩过哪些坑', '液态玻璃'],
  ['用户输入是哪个类负责处理的', 'IOEngine'],
  ['选词优化的 shiply 开关叫什么', 'text_selector_exp_switch'],
  ['实验埋点的 tab 怎么接入', 'tab 的接入文档'],
  ['回答我的时候记得用中文', '始终使用中文回答'],
  ['改完直接提交吧', '不要自动 commit'],
  ['先别写代码，我们讨论方案', '先给出方案讨论'],
  ['上网查点资料', 'WebSearch'],
  ['写 OC 代码要遵守什么规范', 'ios-Objective-C-code-style'],
]

// 与记忆库任何内容都不相干，门控必须全部挡住
const IRRELEVANT = [
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
//
// 2026-09-27 删掉嵌套层数、参数个数、方法行数、读 HANDOFF 四条 rule 后，
// 相关输入剩 14 条且全部命中。下限跟着改为 14。
const MIN_HIT = 14
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
