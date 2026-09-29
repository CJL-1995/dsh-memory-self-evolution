import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { createMemoryHarness, memory } from './helpers/memory.mjs'

const exec = promisify(execFile)

test('所有新建入口的底层初始值固定 0.5，不接受外部置信度', async t => {
  const h = await createMemoryHarness(t)
  const writer = await h.load('lib/core/writer.mjs')
  for (const confidence of [undefined, 0, -1, 0.9, 3, NaN, Infinity]) {
    const mem = await writer.persistMemory({ text: '必须记录错误原因', category: 'rule', confidence })
    assert.equal(mem.confidence, 0.5)
    assert.equal('observations' in mem, false)
  }
  assert.ok((await h.records()).every(mem => mem.confidence === 0.5 && !('observations' in mem)))
  assert.equal(await writer.refreshDeprecated(), 0)
  assert.ok((await h.records()).every(mem => !mem.deprecated))
})

test('强化和合并各加 0.1，无次数统计、无浮点累加误差、可超过 1', async t => {
  const h = await createMemoryHarness(t)
  const writer = await h.load('lib/core/writer.mjs')
  const created = await writer.persistMemory({ text: '日志包含原因', category: 'project' })
  assert.equal((await writer.reinforceMemory(created.id)).confidence, 0.6)
  const merged = await writer.mergeMemory(created.id, '日志包含原因与排查线索')
  assert.equal(merged.confidence, 0.7)
  assert.equal(merged.id, created.id)
  assert.equal(merged.text, '日志包含原因与排查线索')
  assert.equal(h.state.vectorRefreshes, 1)
  for (let i = 0; i < 6; i++) await writer.reinforceMemory(created.id)
  assert.equal((await h.records('project'))[0].confidence, 1.3)
  assert.doesNotMatch(await fsp.readFile(path.join(h.root, 'memories.md'), 'utf8'), /观测|召回频率/)
})

test('旧正式记忆兼容读取，保留历史置信度，更新时清理 observations', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('old', { confidence: 1.15, observations: 20, evidence: '原始证据' })])
  const store = await h.load('lib/core/store.mjs')
  const old = (await store.readGroup('rule'))[0]
  assert.equal(old.confidence, 1.15)
  assert.equal('observations' in old, false)
  assert.equal((await h.records())[0].observations, 20)
  const writer = await h.load('lib/core/writer.mjs')
  await writer.reinforceMemory('old')
  const updated = (await h.records())[0]
  assert.equal(updated.confidence, 1.25)
  assert.equal(updated.evidence, '原始证据')
  assert.equal('observations' in updated, false)
})

test('批量实际召回每 id 加 0.05，去重且忽略失效或已删除记录', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('a'), memory('untouched'), memory('deprecated', { deprecated: true })])
  await h.seed('project', [memory('p', { category: 'project', lastSeen: '2020-01-01T00:00:00.000Z' })])
  const writer = await h.load('lib/core/writer.mjs')
  const result = await writer.rewardRecalledMemories(['a', 'a', 'p', 'missing', 'deprecated'])
  assert.equal(result.length, 2)
  const rules = new Map((await h.records()).map(mem => [mem.id, mem]))
  assert.equal(rules.get('a').confidence, 0.55)
  assert.equal(rules.get('untouched').confidence, 0.5)
  assert.equal(rules.get('deprecated').confidence, 0.5)
  assert.equal(rules.get('deprecated').deprecated, true)
  assert.ok((await h.records('project'))[0].lastSeen > '2020-01-01T00:00:00.000Z')
  await writer.rewardRecalledMemories(['a'])
  assert.equal((await h.records()).find(mem => mem.id === 'a').confidence, 0.6)
  assert.equal(h.state.vectorRefreshes, 0)
  assert.equal((await writer.rewardRecalledMemories([])).length, 0)
})

for (const sideJudge of [true, false]) {
  for (const confirm of [true, false]) {
    test(`实际召回输出加分，sideJudge=${sideJudge} confirm=${confirm}`, async t => {
      const h = await createMemoryHarness(t)
      Object.assign(h.settings, { sideJudge, confirm })
      await h.seed('rule', [memory('hit'), memory('miss')])
      h.state.hits = ['hit', 'hit']
      const render = await h.load('lib/core/render.mjs')
      const text = await render.renderRecall(['用户问题'])
      assert.match(text, /置信度 0.55/)
      assert.equal(text.split('规则 hit').length - 1, 1)
      assert.equal((await h.records()).find(mem => mem.id === 'miss').confidence, 0.5)
      await render.renderRecall(['用户下一轮问题'])
      assert.equal((await h.records()).find(mem => mem.id === 'hit').confidence, 0.6)
    })
  }
}

test('关闭功能、空输入、无命中和召回失败不加分', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('a')])
  const render = await h.load('lib/core/render.mjs')
  h.state.hits = ['a']
  assert.equal(await render.renderRecall([]), '')
  h.settings.enabled = false
  assert.equal(await render.renderRecall(['问题']), '')
  h.settings.enabled = true
  h.state.hits = []
  assert.equal(await render.renderRecall(['问题']), '')
  h.state.recallError = new Error('模拟召回失败')
  assert.equal(await render.renderRecall(['问题']), '')
  assert.equal((await h.records())[0].confidence, 0.5)
  assert.ok(h.errors.some(line => line.includes('模拟召回失败')))
})

test('会话开始按置信度选前 50 条，但不会因为注入而加分', async t => {
  const h = await createMemoryHarness(t)
  const rules = Array.from({ length: 52 }, (_, i) => memory(`r${i}`, { confidence: 0.5 + i / 100 }))
  rules.push(memory('deleted', { confidence: 9, deprecated: true }))
  await h.seed('rule', rules)
  const before = await fsp.readFile(path.join(h.root, 'rule.jsonl'), 'utf8')
  const render = await h.load('lib/core/render.mjs')
  for (const sideJudge of [true, false]) {
    h.settings.sideJudge = sideJudge
    const text = await render.renderSessionStart()
    assert.match(text, /规则 r51（/)
    assert.doesNotMatch(text, /规则 r0（|规则 r1（|规则 deleted（/)
    assert.match(text, /其余 2 条按置信度截断/)
    assert.equal(await fsp.readFile(path.join(h.root, 'rule.jsonl'), 'utf8'), before)
    assert.equal(text.includes('后台自动提取'), sideJudge)
  }
})

test('通用召回用于判重或评测时没有置信度副作用', async t => {
  const h = await createMemoryHarness(t, { realRecall: true })
  await h.seed('rule', [memory('a', { text: '相关' }), memory('b', { text: '不相关' })])
  const store = await h.load('lib/core/store.mjs')
  const recall = await h.load('lib/core/recall.mjs')
  const pool = await store.readAllMemories()
  const before = await fsp.readFile(path.join(h.root, 'rule.jsonl'), 'utf8')
  assert.equal((await recall.recall(['问题'], pool, { topK: 3, gate: false })).length, 2)
  assert.equal((await recall.recall(['问题'], pool)).length, 1)
  assert.equal(await fsp.readFile(path.join(h.root, 'rule.jsonl'), 'utf8'), before)
  const render = await h.load('lib/core/render.mjs')
  await render.renderRecall(['问题'])
  const updated = new Map((await h.records()).map(mem => [mem.id, mem]))
  assert.equal(updated.get('a').confidence, 0.55)
  assert.equal(updated.get('b').confidence, 0.5)
})

test('置信度写入失败仍返回召回正文，并保留排查日志、释放写锁', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('a')])
  h.state.hits = ['a']
  h.state.writeError = true
  const render = await h.load('lib/core/render.mjs')
  assert.match(await render.renderRecall(['问题']), /规则 a（置信度 0.5/)
  assert.equal((await h.records())[0].confidence, 0.5)
  assert.ok(h.errors.some(line => line.includes('ids=a') && line.includes('模拟记忆写入失败')))
  assert.equal((await fsp.readdir(h.root)).some(name => name.startsWith('.memory-write')), false)
  h.state.writeError = false
  assert.match(await render.renderRecall(['重试']), /置信度 0.55/)
})

test('同进程并发的新建、强化、合并、召回与废弃刷新不丢更新', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('a')])
  const writer = await h.load('lib/core/writer.mjs')
  await Promise.all([
    ...Array.from({ length: 8 }, () => writer.reinforceMemory('a')),
    ...Array.from({ length: 8 }, () => writer.rewardRecalledMemories(['a'])),
    writer.mergeMemory('a', '合并后的正文'),
    writer.persistMemory({ text: '新规则', category: 'rule' }),
    writer.refreshDeprecated(),
  ])
  const rules = await h.records()
  assert.equal(rules.length, 2)
  assert.equal(rules.find(mem => mem.id === 'a').confidence, 1.8)
  assert.equal(rules.find(mem => mem.id === 'a').text, '合并后的正文')
  assert.ok(rules.every(mem => !mem.deprecated))
})

test('跨进程并发加分不丢失', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('a')])
  const helper = new URL('./helpers/memory.mjs', import.meta.url).href
  const child = `import { createMemoryHarness } from ${JSON.stringify(helper)}; const h = await createMemoryHarness(null, { home: process.argv[1] }); const writer = await h.load('lib/core/writer.mjs'); for (let i = 0; i < 8; i++) await writer[process.argv[2]](process.argv[2] === 'reinforceMemory' ? 'a' : ['a']);`
  await Promise.all(['reinforceMemory', 'rewardRecalledMemories'].map(operation => exec(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', child, h.home, operation])))
  assert.equal((await h.records())[0].confidence, 1.7)
})

test('新记忆未衰减时有效，闲置满 30 天后才废弃', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('new'), memory('old', { lastSeen: new Date(Date.now() - 31 * 86400000).toISOString() })])
  const writer = await h.load('lib/core/writer.mjs')
  assert.equal(await writer.refreshDeprecated(), 1)
  const rules = new Map((await h.records()).map(mem => [mem.id, mem]))
  assert.equal(rules.get('new').deprecated, false)
  assert.equal(rules.get('old').deprecated, true)
  assert.equal((await writer.reinforceMemory('old')).deprecated, false)
})

test('候选池的出现次数仍保留，不再作为正式记忆强度', async t => {
  const h = await createMemoryHarness(t)
  const candidates = await h.load('lib/core/candidates.mjs')
  await candidates.collectCandidates(['以后必须记录详细的异常日志'], 'test-session')
  await candidates.collectCandidates(['以后必须记录详细的异常日志'], 'test-session')
  const list = await candidates.listCandidates()
  assert.equal(list.length, 1)
  assert.equal(list[0].observations, 2)
})

test('旁路通知只展示置信度，不展示旧 observations', async t => {
  const h = await createMemoryHarness(t)
  const side = await h.load('lib/core/sidepath.mjs')
  for (const action of ['reinforce', 'merge']) {
    const text = side.formatNotice({ action, targetText: '旧规则', mergedText: '新规则', observations: 10 })
    assert.match(text, /置信度 \+0.1/)
    assert.doesNotMatch(text, /观测|召回频率/)
  }
})

test('MCP 不暴露 confidence 入参，旧客户端传值也不能改变初始值', async t => {
  const h = await createMemoryHarness(t)
  h.settings.sideJudge = false
  await h.load('bin/memory-mcp.mjs')
  let sequence = 0
  async function call(method, params) {
    const id = ++sequence
    h.stdin.emit('data', JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    for (let i = 0; i < 200; i++) {
      const result = h.output.map(line => JSON.parse(line)).find(message => message.id === id)
      if (result) return result
      await delay(10)
    }
    throw new Error(`等待 MCP 响应超时 method=${method}`)
  }
  const tools = (await call('tools/list')).result.tools
  assert.equal('confidence' in tools.find(tool => tool.name === 'memory_persist').inputSchema.properties, false)
  const persisted = await call('tools/call', { name: 'memory_persist', arguments: { text: 'MCP新记忆', category: 'rule', confidence: 9 } })
  assert.match(persisted.result.content[0].text, /置信度 0.5/)
  const mem = (await h.records())[0]
  const reinforced = await call('tools/call', { name: 'memory_reinforce', arguments: { id: mem.id } })
  assert.match(reinforced.result.content[0].text, /置信度 0.6/)
  const merged = await call('tools/call', { name: 'memory_merge', arguments: { id: mem.id, text: 'MCP合并记忆' } })
  assert.match(merged.result.content[0].text, /置信度 0.7/)
  assert.doesNotMatch(JSON.stringify([reinforced, merged]), /观测|召回频率/)
})

test('CLI 直接新建同样固定 0.5', async t => {
  const h = await createMemoryHarness(t, { argv: ['rule', 'add', 'CLI新规则'] })
  await h.load('bin/memory.mjs')
  assert.equal((await h.records())[0].confidence, 0.5)
})

test('有效置信度恰好为 0.5 时不因浮点误差废弃', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('boundary', { confidence: 0.7, lastSeen: new Date(Date.now() - 121 * 86400000).toISOString() })])
  const writer = await h.load('lib/core/writer.mjs')
  assert.equal(await writer.refreshDeprecated(), 0)
  assert.equal((await h.records())[0].deprecated, false)
})

test('持锁进程退出后自动恢复，空的遗留锁目录也不阻塞', async t => {
  const h = await createMemoryHarness(t)
  await h.seed('rule', [memory('a')])
  const { stdout } = await exec(process.execPath, ['-e', 'console.log(process.pid)'])
  const owner = `owner-${Number(stdout.trim())}-exited`
  const lock = path.join(h.root, '.memory-write.lock')
  await fsp.mkdir(lock)
  await fsp.writeFile(path.join(lock, owner), '')
  const writer = await h.load('lib/core/writer.mjs')
  await writer.rewardRecalledMemories(['a'])
  assert.equal((await h.records())[0].confidence, 0.55)
  assert.ok(h.errors.some(line => line.includes('回收已退出进程')))
  await fsp.mkdir(lock)
  await writer.rewardRecalledMemories(['a'])
  assert.equal((await h.records())[0].confidence, 0.6)
})

test('旁路 permit 入口保持授权校验，并使用统一置信度规则', async t => {
  const h = await createMemoryHarness(t)
  const side = await h.load('lib/core/sidepath.mjs')
  const jobs = path.join(h.root, 'side')
  await fsp.mkdir(jobs)
  async function proposal(action, targetId, text) {
    await fsp.writeFile(path.join(jobs, 'j_test.json'), JSON.stringify({
      id: 'j_test', status: 'ready', prompted: true, applied: false,
      proposal: { action, text, category: 'rule', targetId, mergedText: text },
      permit: { id: 'test-permit', action, text, category: 'rule', targetId },
    }))
  }
  await proposal('create', '', '旁路规则')
  assert.equal((await side.consumeSidePermit('memory_persist', { text: '旁路规则', category: 'rule' })).ok, false)
  assert.equal((await side.consumeSidePermit('memory_persist', { text: '旁路规则', category: 'rule', permit: 'test-permit', confidence: 9 })).ok, true)
  const created = (await h.records())[0]
  assert.equal(created.confidence, 0.5)
  await proposal('merge', created.id, '合并后的旁路规则')
  assert.equal((await side.consumeSidePermit('memory_merge', { id: created.id, text: '合并后的旁路规则', permit: 'test-permit' })).ok, true)
  assert.equal((await h.records())[0].confidence, 0.6)
  await proposal('reinforce', created.id, '合并后的旁路规则')
  assert.equal((await side.consumeSidePermit('memory_reinforce', { id: created.id, permit: 'test-permit' })).ok, true)
  assert.equal((await h.records())[0].confidence, 0.7)
})
