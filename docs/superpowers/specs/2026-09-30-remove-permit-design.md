# 删除 permit 机制设计

## 背景

Cursor 的 `AskQuestion` 当前不会触发 `postToolUse`，因此插件无法从 Hook 获取用户点选结果，也无法生成一次性 permit。现有 Cursor 旁路确认链路必然停在用户点选之后。

## 目标

- 完整删除 permit 的生成、注入、参数和消费逻辑。
- 保留写盘前的用户确认弹窗。
- Cursor、CodeBuddy、WorkBuddy 统一为：用户点选后，主模型调用对应写工具，MCP 按待确认提案落盘。
- 保留客户端隔离，避免多个客户端同时存在待确认提案时串单。

## 设计

### Hook

- 删除 Cursor 的 `postToolUse` 和 Claude 风格客户端的 `PostToolUse` 注册。
- 安装脚本重新执行时，主动清理历史遗留的本插件 post-tool Hook。
- `bin/memory.mjs` 不再识别 post-tool 事件，也不再生成 `additional_context` permit。

### 待确认提案

- 删除 `issuePermitFromTool`、选项结果解析、permit 生成和 `consumeSidePermit`。
- `applyPendingByTool` 增加客户端参数，只从当前客户端的待确认提案中匹配。
- 三端 MCP 均通过 `applyPendingByTool` 执行旁路确认后的新建、强化或合并。
- 继续保留“新一次确认作废同客户端旧提案”的行为。

### MCP

- 写工具 schema 删除 `permit` 参数。
- 旁路模式下三端统一展示“仅在插件确认弹窗被用户点选后调用”的描述，参数允许省略。
- 保留 MCP 的 `--agent` 参数，仅用于客户端提案隔离，不再用于授权判断。
- 阻塞模式行为不变。

### 文档和测试

- README、DESIGN 删除 permit 描述，改为三端统一确认语义。
- 删除 permit 消费测试。
- 新增三端旁路写入测试、客户端隔离测试及安装配置清理测试。
- 运行完整测试集。

## 风险与降级

删除 permit 后，MCP 无法从技术上证明用户真实点选过确认弹窗，只能依赖主模型遵循插件指令。这是 Cursor 当前未向 AskQuestion 提供 Hook 的宿主限制。

为降低风险：

- 写工具描述限定只能响应标题为“记忆确认·插件”的弹窗。
- MCP 只消费当前客户端已有、未应用且已展示的待确认提案。
- 写入参数由插件提案提供，避免模型篡改正文或目标记忆。
- 无待确认提案时保留原有参数写入能力，以兼容阻塞模式和直接调用。

