import { expect, mock, test } from 'claude-code/testing'
import type { On, RenderElement, SessionMeasureInput } from 'claude-code'

const USAGE = JSON.stringify({
  limits: [
    { kind: 'session', percent: 17, scope: null },
    { kind: 'weekly_scoped', percent: 35, scope: { model: { id: null, display_name: 'Fable' } } },
  ],
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 1 }, view: {} },
} as const

// 2026-10-14 22:30 local, as the mock clock's now.
const NOW = new Date(2026, 9, 14, 22, 30).getTime()
const HOUR = 3_600_000

function subscribed(on: On) {
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: USAGE } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  mock.clock(on, { now: NOW })
}

const READING: SessionMeasureInput = {
  context: { window: 1_000_000, tokens: 140_000, percent: 14 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 17, resetsAt: new Date(NOW + 2 * HOUR + 15 * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 31, resetsAt: new Date(NOW + 3 * 24 * HOUR + 5 * HOUR).toISOString() },
  ],
  cost: { usd: 1.2345 },
  changed: ['context', 'rateLimits', 'cost'],
}

test('by default the band shows context, plan windows with their resets, and per-model windows', async ($, on) => {
  subscribed(on)
  await $.session.measure(READING)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    const line = await ui.find({ type: 'Text' })
    expect(line?.text).toBe('Context 14% · Session 17% (2hr 15m) · Weekly 31% (3d 5hr) · Fable 35%')
    await ui.unmount()
  }
})

test('without a first-party credential the band shows the context alone', async ($, on) => {
  on('session.authorize', () => ({ value: null }))
  on('http.fetch', () => { throw new Error('must not be called') })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  mock.clock(on, { now: NOW })

  await $.session.measure({
    context: { window: 200_000, tokens: 50_000, percent: 25 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Context 25%')
})

const ALL_ON = Object.fromEntries(
  ['model', 'folder', 'branch', 'context', 'tokens', 'session', 'weekly', 'resets', 'models', 'cost', 'turns', 'duration', 'clock']
    .map(k => [k, true]),
)

test('with every part on the band shows them all in order', { options: ALL_ON }, async ($, on) => {
  subscribed(on)
  on('session.cwd', () => ({ value: '/home/anon/work/context-band' }))
  on('session.model', () => ({ value: 'Fable 5.1' }))
  on('session.turns', () => ({ value: 12 }))
  on('session.usage', () => ({
    value: { startedAt: NOW - 75 * 60_000, context: READING.context, rateLimits: READING.rateLimits },
  }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/home/anon/work/context-band/.git' }))
  on('fs.stat', () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => {
    expect(e.path).toBe('/home/anon/work/context-band/.git/HEAD')
    return { value: 'ref: refs/heads/main\n' }
  })

  await $.session.measure(READING)

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    'Fable 5.1 · context-band (main) · Context 14% (140k/1M) · Session 17% (2hr 15m) · Weekly 31% (3d 5hr) · Fable 35% · $1.23 · 12 turns · Elapsed 1hr 15m · 22:30',
  )
})

test('a worktree checkout reads the branch through its gitdir file', { options: { branch: true, context: false, session: false, weekly: false, models: false } }, async ($, on) => {
  subscribed(on)
  on('session.cwd', () => ({ value: '/home/anon/work/context-band/.worktrees/feature/sub' }))
  on('fs.exists', (_$, e) => ({ value: e.path === '/home/anon/work/context-band/.worktrees/feature/.git' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 60, mtimeMs: 0, isLink: false } }))
  on('fs.read', (_$, e) => ({
    value: e.path.endsWith('/.git')
      ? 'gitdir: /home/anon/work/context-band/.git/worktrees/feature\n'
      : 'ref: refs/heads/feature/band-parts\n',
  }))

  await $.session.measure(READING)

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('feature/band-parts')
})

test('parts switched off leave the line, and the usage endpoint is not called with per-model windows off', { options: { session: false, resets: false, models: false, cost: true } }, async ($, on) => {
  on('session.authorize', () => { throw new Error('must not be called') })
  on('http.fetch', () => { throw new Error('must not be called') })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  mock.clock(on, { now: NOW })

  await $.session.measure(READING)

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Context 14% · Weekly 31% · $1.23')
})

test('with every part off the band leaves the drawing to the engine', { options: { context: false, session: false, weekly: false, resets: false, models: false } }, async ($, on) => {
  subscribed(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'the engine drew this') as RenderElement
  })
  await $.session.measure(READING)

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'terminal', ...BAND })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('the engine drew this')
})

test('a failed usage request keeps the last per-model reading, and the endpoint is asked at most once per five minutes', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  const answers = [
    { status: 200, ok: true, headers: {}, text: USAGE },
    { status: 429, ok: false, headers: {}, text: '{"error":{"type":"rate_limit_error"}}' },
  ]
  let calls = 0
  on('http.fetch', () => ({ value: answers[calls++]! }))

  await $.session.measure(READING)
  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', ...BAND })
  const line = async () => (await ui.find({ type: 'Text' }))?.text
  expect(await line()).toBe('Context 14% · Session 17% (2hr 15m) · Weekly 31% (3d 5hr) · Fable 35%')
  expect(calls).toBe(1)

  await clock.advance(5 * 60_000)
  await $.session.measure(READING)
  expect(calls).toBe(2)
  expect(await line()).toBe('Context 14% · Session 17% (2hr 10m) · Weekly 31% (3d 4hr) · Fable 35%')

  await clock.advance(60_000)
  await $.session.measure(READING)
  expect(calls).toBe(2)
  expect(await line()).toBe('Context 14% · Session 17% (2hr 9m) · Weekly 31% (3d 4hr) · Fable 35%')
})
