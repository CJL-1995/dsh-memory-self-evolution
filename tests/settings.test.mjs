import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'memory-settings-'))
process.env.HOME = home
const root = path.join(home, '.memory-self-evolution')
const configFile = path.join(root, 'config.json')
test.after(() => fsp.rm(home, { recursive: true, force: true }))

let generation = 0
async function freshSettings(config) {
  await fsp.rm(root, { recursive: true, force: true })
  if (config !== undefined) {
    await fsp.mkdir(root, { recursive: true })
    await fsp.writeFile(configFile, JSON.stringify(config))
  }
  return import(`../lib/core/settings.mjs?generation=${++generation}`)
}

test('decayDays缺省为30，可在config.json中改为正整数', async () => {
  assert.equal((await (await freshSettings()).loadSettings()).decayDays, 30)
  assert.equal((await (await freshSettings({ decayDays: 7 })).loadSettings()).decayDays, 7)
})

test('config.json中的非法decayDays回退为30', async () => {
  for (const decayDays of [0, -1, 1.5, '7']) {
    assert.equal((await (await freshSettings({ decayDays })).loadSettings()).decayDays, 30)
  }
})

test('通过updateSetting修改decayDays，非法值被拒绝且不写入', async () => {
  const settings = await freshSettings()
  assert.equal((await settings.updateSetting('decayDays', '14')).ok, true)
  assert.equal(JSON.parse(await fsp.readFile(configFile, 'utf8')).decayDays, 14)
  for (const value of ['0', '-3', '1.5', 'abc']) {
    assert.equal((await settings.updateSetting('decayDays', value)).ok, false)
  }
  assert.equal(JSON.parse(await fsp.readFile(configFile, 'utf8')).decayDays, 14)
  assert.equal((await settings.loadSettings()).decayDays, 14)
})
