# 向量召回 + jsonl 主存储 —— 改造方案

> 目标：用 nomic-embed-text 向量召回替换 Jaccard 粗筛，让「语义近义但字面不同」的记忆也能被召回，对齐得物方案的语义去重能力。jsonl 主存储与所有读取路径不变。

## 一、总体思路

只换「候选集召回」这一环：

```
现状：去重时用「最近 20 条 + Jaccard 粗筛」召回历史记忆
改后：去重时用「向量 top-k」召回历史记忆（语义级）

jsonl 主存储：完全不动（读、写、注入、UI 照旧）
```

## 二、embedding 调用方式

- **依赖**：`@huggingface/transformers`（自带 `onnxruntime-node`）。
- **模型**：`nomic-ai/nomic-embed-text-v1.5` 的 ONNX int8 量化版（~137MB，首次下载后缓存本地）。
- **维度**：768（Matryoshka 支持截断到 256，但索引内存差异可忽略，用 768 省心）。
- **懒加载单例**：第一次去重时才加载模型，不阻塞 DSH 启动；加载一次约几百 ms~2s，之后常驻复用。
- **降级**：模型加载失败时回退到「最近 20 条 + Jaccard 粗筛」。

## 三、新增文件

| 文件 | 内容 |
|---|---|
| `lib/embedding.js` | 模型加载、`embed(texts)`、`cosine()` |
| `~/.dsh-memory/embeddings.jsonl` | 向量索引（运行时生成，每行 `{id, v:[...]}`，768 维） |

## 四、改动点（都在 `lib/index.js`）

1. **新增向量索引管理**：`loadVecIndex` / `saveVecIndex` / `addVec` / `removeVec` / `searchVec`（暴力余弦 top-k，几百条毫秒级，无需 ANN）。
2. **`buildShortlist` 改向量召回**：本轮消息算向量 → top-20 相似 id → 回 jsonl 取正文。
3. **`analyzeSession` 删 Jaccard 安全网**：语义等价判断只认 LLM。
4. **persist / removeMemory 路由同步向量**：沉淀时 `addVec`，删除时 `removeVec`。
5. **`dedupe`（候选内部去重）**：保留字符 Jaccard 不动。

## 五、资源消耗

- 内存：模型 ~200-300MB（int8）+ 索引几 MB。
- CPU：写记忆/去重时短时峰值，非持续。
- 磁盘：模型 ~137MB + 索引文件几 MB。

## 六、降级与风险

- 模型加载/下载失败 → 回退「最近 20 条 + Jaccard 粗筛」。
- 冷启动首轮触发模型加载（几百 ms~2s），仅一次。
- 索引与 jsonl 不一致 → 启动时校验：补算缺失向量、丢弃多余向量，或提供「重建索引」。

## 七、分步实施

1. `package.json` 加依赖 + 写 `lib/embedding.js`，跑通 load/embed/cosine；
2. 加向量索引 load/save/add/remove/search；
3. `buildShortlist` 切向量召回；
4. 删 `analyzeSession` 的 Jaccard 安全网；
5. persist/removeMemory 路由同步向量；
6. 加降级回退 + 索引一致性校验。
