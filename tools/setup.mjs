#!/usr/bin/env node
// 给当前用户注册 Cursor、codebuddy 与 WorkBuddy 的 hook 和 MCP。
// 已有其他 hook / MCP 会保留。本插件已注册时只更新 node 与仓库路径，不重复追加。
// 用法：npm install && npm run setup

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const nodeBin = process.execPath
const hookScript = path.join(repoRoot, 'bin', 'memory.mjs')
const mcpScript = path.join(repoRoot, 'bin', 'memory-mcp.mjs')

const CURSOR_EVENTS = [
  { event: 'sessionStart', timeout: 10 },
  { event: 'beforeSubmitPrompt', timeout: 5 },
  { event: 'stop', timeout: 20 },
]
const CODEBUDDY_EVENTS = [
  { event: 'SessionStart', timeout: 10 },
  { event: 'UserPromptSubmit', timeout: 10 },
  { event: 'Stop', timeout: 20 },
]

function hookCommand(agent) {
  return `"${nodeBin}" "${hookScript}" hook --agent ${agent}`
}

function isOurHook(command, agent) {
  const text = String(command || '')
  return text.includes('memory.mjs') && text.includes(`hook --agent ${agent}`)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`读取 ${file} 失败：${error.message}`)
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp.${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function upsertCursorHook(list, command, timeout) {
  const found = list.find((item) => isOurHook(item && item.command, 'cursor'))
  if (found) {
    found.command = command
    found.timeout = timeout
    return 'updated'
  }
  list.push({ command, timeout })
  return 'added'
}

function upsertClaudeStyleHook(list, command, timeout, agent) {
  for (const group of list) {
    const hooks = Array.isArray(group && group.hooks) ? group.hooks : []
    const found = hooks.find((item) => isOurHook(item && item.command, agent))
    if (!found) continue
    found.type = 'command'
    found.command = command
    found.timeout = timeout
    return 'updated'
  }
  list.push({
    matcher: '',
    hooks: [{ type: 'command', command, timeout }],
  })
  return 'added'
}

function registerMcp(file) {
  const data = readJson(file, { mcpServers: {} })
  if (!data.mcpServers || typeof data.mcpServers !== 'object') data.mcpServers = {}
  const existed = Boolean(data.mcpServers['memory-self-evolution'] || data.mcpServers['dsh-memory'])
  delete data.mcpServers['dsh-memory']
  data.mcpServers['memory-self-evolution'] = {
    type: 'stdio',
    command: nodeBin,
    args: [mcpScript],
    description: '跨会话长期记忆：读取记忆、沉淀新记忆、强化已有记忆、处理待确认候选',
  }
  writeJson(file, data)
  return existed ? 'updated' : 'added'
}

function registerCursor(home) {
  const dir = path.join(home, '.cursor')
  if (!fs.existsSync(dir)) return '未安装，已跳过'
  const hooksFile = path.join(dir, 'hooks.json')
  const data = readJson(hooksFile, { version: 1, hooks: {} })
  if (!data.hooks || typeof data.hooks !== 'object') data.hooks = {}
  if (data.version == null) data.version = 1
  const command = hookCommand('cursor')
  const notes = []
  for (const spec of CURSOR_EVENTS) {
    if (!Array.isArray(data.hooks[spec.event])) data.hooks[spec.event] = []
    const action = upsertCursorHook(data.hooks[spec.event], command, spec.timeout)
    notes.push(`${spec.event} ${action}`)
  }
  writeJson(hooksFile, data)
  const mcp = registerMcp(path.join(dir, 'mcp.json'))
  return `hooks ${notes.join(', ')}; mcp ${mcp}`
}

// codebuddy 与 WorkBuddy 都是 Claude Code 系：settings.json 里的 hooks，mcp.json 里的 MCP。
// WorkBuddy 启动 CLI 时把 CODEBUDDY_CONFIG_DIR 指到 ~/.workbuddy，所以两套配置必须分开写。
function registerClaudeStyle(home, dirName, agent) {
  const dir = path.join(home, dirName)
  if (!fs.existsSync(dir)) return '未安装，已跳过'
  const settingsFile = path.join(dir, 'settings.json')
  const data = readJson(settingsFile, { hooks: {} })
  if (!data.hooks || typeof data.hooks !== 'object') data.hooks = {}
  const command = hookCommand(agent)
  const notes = []
  for (const spec of CODEBUDDY_EVENTS) {
    if (!Array.isArray(data.hooks[spec.event])) data.hooks[spec.event] = []
    const action = upsertClaudeStyleHook(data.hooks[spec.event], command, spec.timeout, agent)
    notes.push(`${spec.event} ${action}`)
  }
  writeJson(settingsFile, data)
  const mcp = registerMcp(path.join(dir, 'mcp.json'))
  return `hooks ${notes.join(', ')}; mcp ${mcp}`
}

function migrateDataDir(home) {
  const oldDir = path.join(home, '.dsh-memory')
  const newDir = path.join(home, '.memory-self-evolution')
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return
  fs.renameSync(oldDir, newDir)
  console.log(`已把 ${oldDir} 迁到 ${newDir}`)
}

const home = os.homedir()
migrateDataDir(home)
console.log(`node ${nodeBin}`)
console.log(`仓库 ${repoRoot}`)
console.log(`Cursor：${registerCursor(home)}`)
console.log(`codebuddy：${registerClaudeStyle(home, '.codebuddy', 'codebuddy')}`)
console.log(`WorkBuddy：${registerClaudeStyle(home, '.workbuddy', 'workbuddy')}`)
console.log('记忆数据在 ~/.memory-self-evolution/，不会随仓库分发。重启客户端后 MCP 才会加载。')
