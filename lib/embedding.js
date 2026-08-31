// 本地轻量 embedding 模型：把文本映射成语义向量，用于记忆的语义召回（替代 Jaccard 粗筛）。
// 注意：transformers 用动态 import 懒加载——未安装/下载失败时只影响本模块，不会拖垮整个插件。

const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5'

let extractor = null
let loadingPromise = null

async function ensureModel() {
  if (extractor) return extractor
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    const { pipeline } = await import('@huggingface/transformers')
    const p = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' })
    extractor = p
    return p
  })()
  try {
    return await loadingPromise
  } finally {
    loadingPromise = null
  }
}

// L2 归一化：归一化后两向量的点积即余弦相似度。
function norm(v) {
  let s = 0
  for (const x of v) s += x * x
  const l = Math.sqrt(s) || 1
  const out = new Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i] / l
  return out
}

// 批量文本 -> 向量数组（number[][]）。懒加载模型，失败时抛错由调用方降级。
export async function embed(texts) {
  const model = await ensureModel()
  const list = Array.isArray(texts) ? texts : [texts]
  const out = await model(list, { pooling: 'mean', normalize: true })
  let vecs
  if (out && typeof out.tolist === 'function') {
    const arr = out.tolist()
    vecs = Array.isArray(arr[0]) ? arr : [arr]
  } else if (Array.isArray(out)) {
    vecs = out.map((t) => (t && t.data ? Array.from(t.data) : Array.from(t)))
  } else if (out && out.data) {
    vecs = [Array.from(out.data)]
  } else {
    throw new Error('embedding: unexpected output shape')
  }
  return vecs.map(norm)
}

// 余弦相似度（入参需已归一化，否则结果不准确）。
export function cosine(a, b) {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}
