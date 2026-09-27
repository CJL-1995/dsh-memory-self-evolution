# memory-self-evolution

给 **Cursor** 和 **codebuddy** 用的自进化长期记忆。它把你在对话里表达过的偏好、规范和项目事实沉淀下来，靠本地向量模型按相关性召回，并让记忆随使用频率增长、随闲置时间衰减。

记忆存在 `~/.memory-self-evolution/`，两端共用同一份，不上云。

## 它解决什么

同一条偏好反复讲。换个会话又要重新交代项目背景。规则说过但模型下次就忘了。

这个工具的做法是：把这类内容落盘，然后在**两个时机**把它送回模型的上下文——会话开始时无条件注入规则，每轮输入时按语义相关性召回项目事实。

## 记忆分两类

| 类别 | 注入方式 | 典型内容 |
|---|---|---|
| `rule` | 会话开始全量注入，无条件生效 | 「回答用中文」「改完代码不要自动 commit」 |
| `project` | 每轮按语义相关性召回 | 「选词优化的 shiply 开关是 xxx」「IOEngine 负责输入输出」 |

这一刀是按**怎么用**划分的，不是按主题。规则必须无条件注入，因为向量召回按语义相关性触发，覆盖不了「用户没提及但规则本该生效」的情况——你说「帮我改下这个函数」时，「改完不要自动 commit」和这句话在语义上并不相似，实测这类输入的召回分数只有 0.12~0.24，和无关输入完全重叠。这是机制上的边界，不是召回质量问题。

## 安装

需要 Node 20 以上。clone 到本机后执行这一行，依赖安装和两端注册会一起做完：

```bash
git clone https://github.com/CJL-1995/memory-self-evolution.git && cd memory-self-evolution && npm install && npm run setup
```

已经 clone 过、只需要重新注册时：

```bash
npm install && npm run setup
```

`npm run setup` 执行 `tools/setup.mjs`。它用当前 `node` 的绝对路径，把 hook 和 MCP 写进本机已安装的客户端：

| 客户端 | hook | MCP |
|---|---|---|
| Cursor（存在 `~/.cursor`） | `hooks.json` 的 `sessionStart`、`beforeSubmitPrompt`、`stop` | `mcp.json` 的 `memory-self-evolution` |
| codebuddy（存在 `~/.codebuddy`） | `settings.json` 的 `SessionStart`、`UserPromptSubmit`、`Stop` | `mcp.json` 的 `memory-self-evolution` |

没有安装的客户端会跳过。已有的其他 hook 和 MCP 会保留。本插件已经注册过时，只更新 node 与仓库路径，不会追加第二条。hook 里必须写 node 的绝对路径，脚本会处理；手写相对路径时，hook 失败是静默的。

记忆数据在 `~/.memory-self-evolution/`，按用户分开，不会随仓库分发。同事装完是空记忆库。首次召回或沉淀会下载向量模型（`bge-base-zh-v1.5`，约 98MB），之后离线。

注册完成后重启 Cursor 和 codebuddy，MCP 才会加载。

## 怎么让它记住东西

**让模型自己判断。** 你说「以后都要先跑测试再提交」，模型识别出这是跨轮次约定，调 `memory_propose` 拿到相近记忆和分组建议，再用宿主应用内提问工具请你确认后落盘。Cursor 弹出 `AskQuestion`，CodeBuddy 弹出 `AskUserQuestion`。这条路的好处是模型有完整对话上下文，判断力比任何外挂规则都强。

**自己直接写。** 不想经过模型判断时：

```bash
node bin/memory.mjs rule add "所有异常处理处都需要添加日志"
```

**从历史会话里捞。** 每轮结束时 `stop` hook 会扫一遍对话，把带「以后」「记住」「别再」「一律」这类跨轮次标志的表达收进候选池并累计出现次数——跨会话反复出现的才值得沉淀，一次性噪音只会出现一次。用 `memory_review` 或 `node bin/memory.mjs review` 查看并确认。

## 命令

```bash
node bin/memory.mjs list                  # 两组各有多少条
node bin/memory.mjs read rule             # 看规则
node bin/memory.mjs read project          # 看项目事实
node bin/memory.mjs rule add "<规则>"      # 直接新增规则
node bin/memory.mjs review                # 待确认候选
node bin/memory.mjs config                # 查看配置
node bin/memory.mjs config recallTopK 15  # 改配置
npm run setup                                 # 注册 Cursor / codebuddy
npm run verify                                # 跑召回回归测试
```

## MCP 工具

| 工具 | 作用 |
|---|---|
| `memory_list` | 两组记忆的条数 |
| `memory_read` | 读某一组的全部记忆 |
| `memory_propose` | 提交待沉淀内容，返回相近记忆与分组建议，**不落盘** |
| `memory_persist` | 正式写入 |
| `memory_reinforce` | 强化已有记忆（置信度 +0.1） |
| `memory_review` | 列出待确认候选 |
| `memory_discard` | 丢弃候选 |
| `memory_config` | 查看或修改配置 |

`memory_propose` 故意不落盘：它先把语义相近的已有记忆列出来，让模型判断该「强化已有」还是「新建」，避免记忆库堆满同义重复。

## 配置

`~/.memory-self-evolution/config.json`，不存在时用默认值。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉后不注入任何记忆 |
| `recallTopK` | `10` | 每轮召回条数**上限**（不是配额，不相关时一条都不注入） |
| `recallMinScore` | `0.22` | 相关度下限，`-1` 关闭 |
| `recallMinMargin` | `-1` | 对第二名的领先幅度下限，默认关闭 |
| `confirm` | `true` | 沉淀前是否需要确认 |

## 实测数据

在 24 条真实记忆、16 条相关输入 + 11 条无关输入上：

- 相关召回 **14/16**，无关误放行 2/11，其中真正污染上下文的（拉进 `project` 记忆的）**0 条**
- 每轮 hook 端到端 **0.23 秒**，其中模型冷启动 104ms、单条编码 5.2ms
- 1 万条记忆时的相似度计算 **6.2ms**——瓶颈不在算法，在索引的读盘与解析

## 已知限制

正文写得不自包含的记忆召不回来。比如正文只有「tab 的接入文档链接为…」而不说自己是关于什么的，问「实验设置的文档」就匹配不上。沉淀时正文必须能脱离当时的对话独立读懂。

向量索引用 jsonl 存，每个浮点数占约 20 字节、比 float32 二进制膨胀 5 倍。到约 3.4 万条记忆时会撞上 V8 单字符串长度上限，读写都会抛 `RangeError`。届时需要换二进制格式。

## 设计文档

置信度演化、召回策略、判重、遗忘机制的完整说明和实测依据，见 [DESIGN.md](./DESIGN.md)。

迭代这个项目时，先召回长期记忆里的「自进化记忆系统项目」。
