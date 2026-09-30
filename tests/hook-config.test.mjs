import test from 'node:test'
import assert from 'node:assert/strict'
import { removePluginHookEvent } from '../lib/core/hook-config.mjs'

test('清理 Cursor 旧 postToolUse Hook 时保留其他插件', () => {
  const hooks = {
    postToolUse: [
      { command: 'other hook' },
      { command: 'node "/repo/bin/memory.mjs" hook --agent cursor', timeout: 10 },
    ],
  }

  assert.equal(removePluginHookEvent(hooks, 'postToolUse', 'cursor'), 1)
  assert.deepEqual(hooks.postToolUse, [{ command: 'other hook' }])
})

test('清理 Claude 风格旧 PostToolUse Hook 时保留同组其他 Hook', () => {
  const hooks = {
    PostToolUse: [
      {
        matcher: '',
        hooks: [
          { type: 'command', command: 'other hook' },
          { type: 'command', command: 'node "/repo/bin/memory.mjs" hook --agent codebuddy', timeout: 10 },
        ],
      },
      {
        matcher: 'Write',
        hooks: [{ type: 'command', command: 'another hook' }],
      },
    ],
  }

  assert.equal(removePluginHookEvent(hooks, 'PostToolUse', 'codebuddy'), 1)
  assert.deepEqual(hooks.PostToolUse, [
    { matcher: '', hooks: [{ type: 'command', command: 'other hook' }] },
    { matcher: 'Write', hooks: [{ type: 'command', command: 'another hook' }] },
  ])
})

test('旧事件只有本插件 Hook 时删除空事件', () => {
  const hooks = {
    postToolUse: [{ command: 'node "/repo/bin/memory.mjs" hook --agent cursor' }],
  }

  assert.equal(removePluginHookEvent(hooks, 'postToolUse', 'cursor'), 1)
  assert.equal(Object.hasOwn(hooks, 'postToolUse'), false)
})
