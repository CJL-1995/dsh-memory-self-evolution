#!/usr/bin/env node
// 测量候选 embedding 模型的冷启动与推理延迟。
// 短命 CLI 进程模式下冷启动每轮都要付一次，是选型的硬约束。
// 用法：BENCH_MODEL=<model-id> node tools/bench-latency.mjs

import { pipeline } from '@huggingface/transformers'

const MODEL_ID = process.env.BENCH_MODEL
if (!MODEL_ID) {
  console.error('需要指定 BENCH_MODEL')
  process.exit(1)
}

const ONE = ['首页导航栏的毛玻璃效果在深色模式下要注意什么']
const BATCH = Array.from({ length: 24 }, (_, i) => `记忆条目 ${i}：示例项目的技术背景说明与接口约定`)

const t0 = Date.now()
const extract = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
const coldMs = Date.now() - t0

const opts = { pooling: 'mean', normalize: true }
await extract(ONE, opts) // 预热，排除首次推理的图初始化开销

let t = Date.now()
for (let i = 0; i < 10; i++) await extract(ONE, opts)
const singleMs = (Date.now() - t) / 10

t = Date.now()
await extract(BATCH, opts)
const batchMs = Date.now() - t

const rss = Math.round(process.memoryUsage().rss / 1024 / 1024)
console.log(
  [MODEL_ID.padEnd(34), `冷启动 ${String(coldMs).padStart(5)}ms`, `单条 ${singleMs.toFixed(1).padStart(6)}ms`, `24条批量 ${String(batchMs).padStart(5)}ms`, `RSS ${rss}MB`].join('  ')
)
