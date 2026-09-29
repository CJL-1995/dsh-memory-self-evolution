# memory-self-evolution

给 **Cursor**、**codebuddy** 和 **WorkBuddy** 用的自进化长期记忆。它把你在对话里表达过的偏好、规范和项目事实沉淀下来，靠本地向量模型按相关性召回，并让记忆随使用频率增长、随闲置时间衰减。

记忆存在 `~/.memory-self-evolution/`，三端共用同一份，不上云。

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

需要 Node 20 以上。在终端里执行：

```bash
git clone https://github.com/CJL-1995/memory-self-evolution.git
cd memory-self-evolution
npm install
npm run setup
```

已经 clone 过时，在仓库目录重新执行 `npm install && npm run setup`。`npm run setup` 必须在终端里跑，它会按下面的顺序做完。

1. 只问三件事，其余配置用默认值。
   - 旁路式还是阻塞式。直接回车默认旁路式。
   - 弹出确认还是自动追加。直接回车默认弹出确认。
   - 选了旁路式，再填 `baseUrl`、`apiKey`、`apiModel`。这三项没有缺省值。输入 `skip` 跳过，安装后自己写入 `~/.memory-self-evolution/config.json` 的 `sideApiBase`、`sideApiModel`，以及 `side-secret.json` 的 `apiKey`。缺任何一项，旁路这一轮不写记忆。
2. 把选择写进 `~/.memory-self-evolution/`。目录不存在时会建出来。这里只落配置和密钥，记忆文件要等第一次写入才出现。同事装完是空记忆库。
3. 下载向量模型 `bge-base-zh-v1.5`（约 98MB）到本仓库的 `node_modules/@huggingface/transformers/.cache/`。缓存已在则直接复用。下载失败时安装中止，后面的 hook 和 MCP 不会注册。
4. 用当前 `node` 的绝对路径，把 hook 和 MCP 写进本机已经安装的客户端。没装的客户端跳过。已有的其他 hook 和 MCP 保留。本插件注册过时，只更新 node 与仓库路径，不会追加第二条。

| 客户端 | hook | MCP |
|---|---|---|
| Cursor（存在 `~/.cursor`） | `hooks.json` 的 `sessionStart`、`beforeSubmitPrompt`、`stop`、`postToolUse` | `mcp.json` 的 `memory-self-evolution` |
| codebuddy（存在 `~/.codebuddy`） | `settings.json` 的 `SessionStart`、`UserPromptSubmit`、`Stop`、`PostToolUse` | `mcp.json` 的 `memory-self-evolution` |
| WorkBuddy（存在 `~/.workbuddy`） | `settings.json` 的 `SessionStart`、`UserPromptSubmit`、`Stop`、`PostToolUse` | `mcp.json` 的 `memory-self-evolution` |

三端写入的是同一个 MCP 进程。旁路还是阻塞不改变装上去的程序，只改变 `config.json` 里的 `sideJudge`。进程启动后读这个值：旁路不列出 `memory_propose`，`memory_persist`、`memory_reinforce`、`memory_merge` 仍然列出。阻塞四个都列出。hook 两组模式都装，和通路无关。

注册完成后重启 Cursor、codebuddy 和 WorkBuddy，MCP 才会加载。之后只改通路时运行 `node tools/setup.mjs sidepath` 或 `node tools/setup.mjs blocking`，不再提问，同样会先确认模型缓存再重新注册。WorkBuddy 的 `UserPromptSubmit` 超时 10 秒，宿主会等 hook 返回后再把本轮交给模型，和 codebuddy 相同。

## 卸载

```bash
npm run uninstall
```

插件仓库保留。它会删掉安装时落下的向量模型、三端里本插件的 hook，以及 `mcp.json` 里的 `memory-self-evolution`。其他 hook 和 MCP 不动。

`~/.memory-self-evolution/` 目录保留。`rule.jsonl`、`project.jsonl`、`memories.md`、`embeddings.jsonl`、`candidates.json`、`project-memory` 保留。`config.json`、`side-secret.json` 和 `side/` 删除。重新安装时再跑 `npm run setup`，模型会重新下载，配置会重新写。卸完后重启三个客户端，MCP 才会从已经打开的会话里消失。

## 怎么让它记住东西

沉淀只走一条通路，由 `sideJudge` 决定。`confirm` 只决定写盘前弹不弹确认，两条通路都适用。

**旁路（`sideJudge=true`，安装时直接回车即此项）。** hook 在后台判断这句该不该记，不挡住本轮回答。工具列表里没有 `memory_propose`，有 `memory_persist`、`memory_reinforce`、`memory_merge`。`confirm=false` 时后台直接写入、强化或合并，`stop` 只让主模型把结果原样展示出来。`confirm=true` 时，`stop` 让主模型弹出确认，先不写。用户点选返回后，`postToolUse`（Cursor）或 `PostToolUse`（CodeBuddy、WorkBuddy）生成一次性 permit，放进模型上下文。主模型再调用对应写工具并带上 permit。permit 对不上，或点选前就调用，会拒绝。选「不落成」不发 permit。阻塞模式不校验 permit。三端共用同一条旁路：请求 `sideApiBase/chat/completions`，模型为 `sideApiModel`，密钥为 `side-secret.json` 的 `apiKey`。这三项没有缺省值。没配齐或调用失败时，这一轮不写、也不弹窗。

**阻塞（`sideJudge=false`）。** 旁路不启动。先运行 `node tools/setup.mjs blocking`，它把 `sideJudge` 写成 false，并把 MCP 装到本机已有的 Cursor、codebuddy、WorkBuddy。重启客户端后，主模型才能看到写记忆工具。你说「以后都要先跑测试再提交」，主模型调 `memory_propose` 拿到相近记忆和分组建议。`confirm=true` 时再用宿主应用内提问工具请你确认后落盘。Cursor 弹出 `AskQuestion`，CodeBuddy 和 WorkBuddy 弹出 `AskUserQuestion`。`confirm=false` 时，分组信号明确就按判重提示直接落盘；信号缺失时仍弹确认。`memory_propose` 返回最相近的两条记忆和相似度，由主模型判断新建、强化或合并。切回旁路运行 `node tools/setup.mjs sidepath`，然后重启。

**自己直接写。** 不想经过模型判断时：

```bash
node bin/memory.mjs rule add "所有异常处理处都需要添加日志"
```

**从历史会话里捞。** 关键词候选池仍然保留：带「以后」「记住」「别再」「一律」的原话会累计出现次数。用 `memory_review` 或 `node bin/memory.mjs review` 查看并确认。

## 命令

```bash
node bin/memory.mjs list                  # 两组各有多少条
node bin/memory.mjs read rule             # 看规则
node bin/memory.mjs read project          # 看项目事实
node bin/memory.mjs rule add "<规则>"      # 直接新增规则
node bin/memory.mjs review                # 待确认候选
node bin/memory.mjs config                # 查看配置
node bin/memory.mjs config recallTopK 15  # 改配置
npm run setup                                 # 交互安装并注册 Cursor / codebuddy / WorkBuddy
npm run uninstall                             # 卸掉模型、hook、MCP 和配置，保留记忆与插件仓库
node tools/setup.mjs sidepath                 # 切到旁路，确认模型缓存并重新注册
node tools/setup.mjs blocking                 # 切到阻塞，确认模型缓存并重新注册
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
| `memory_merge` | 用合并后的正文替换已有记忆，重新向量化，并强化一次 |
| `memory_review` | 列出待确认候选 |
| `memory_discard` | 丢弃候选 |
| `memory_config` | 查看或修改配置 |

`memory_propose` 只在阻塞模式出现。旁路模式仍列出 `memory_persist`、`memory_reinforce`、`memory_merge`，但必须带点选后发放的一次性 permit。`memory_propose` 不落盘：它返回最相近的两条记忆和相似度，让主模型判断新建、强化或合并。相似度越高越应当强化，而不是新建。

## 配置

`~/.memory-self-evolution/config.json`，不存在时用默认值。

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉后不注入任何记忆 |
| `recallTopK` | `10` | 每轮召回条数**上限**（不是配额，不相关时一条都不注入） |
| `recallMinScore` | `0.22` | 每条召回的绝对下限，`-1` 关闭。实际保留线是 `max(该值, top1 × 0.6)`，再截到 `recallTopK` |
| `recallMinMargin` | `-1` | 对第二名的领先幅度下限，默认关闭 |
| `confirm` | `true` | 写盘前是否弹确认。旁路和阻塞都适用。关掉后：旁路直接写入，`stop` 只展示结果；阻塞模式在分组明确时直接落盘，信号缺失时仍弹确认 |
| `sideJudge` | `true` | `true` 为旁路，`false` 为阻塞。两条通路互斥。不能用 `memory_config` 改，只能运行 `node tools/setup.mjs sidepath` 或 `node tools/setup.mjs blocking`，然后重启客户端 |
| `sideWaitMs` | `12000` | 回答结束后，`stop` 等待旁路结果的毫秒数 |
| `sideApiBase` | 无 | 旁路接口根地址，必填，没有缺省值。安装时填写，或之后写入本文件 |
| `sideApiModel` | 无 | 旁路模型名，必填，没有缺省值 |

密钥不在这张表里。`~/.memory-self-evolution/side-secret.json` 的 `apiKey` 同样必填，权限 600。

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
