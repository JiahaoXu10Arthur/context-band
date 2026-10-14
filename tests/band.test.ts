import { expect, test } from 'claude-code/testing'

const USAGE = JSON.stringify({
  limits: [
    { kind: 'session', percent: 17, scope: null },
    { kind: 'weekly_scoped', percent: 35, scope: { model: { id: null, display_name: 'Fable' } } },
  ],
})

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10 } } as const

test('band shows context, plan windows and per-model windows', async ($, on) => {
  on('session.authorize', () => ({ value: { handle: 'h', kind: 'bearer' } }))
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: USAGE } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 1_000_000, tokens: 140_000, percent: 14 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 17 },
      { kind: 'seven_day', percentUsed: 31 },
    ],
    changed: ['context', 'rateLimits'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-band', surface, ...BAND })
    const line = await ui.find({ type: 'Text' })
    expect(line?.text).toBe('context 14% · session 17% · weekly 31% · Fable 35%')
    await ui.unmount()
  }
})

test('without a first-party credential the band shows the context alone', async ($, on) => {
  on('session.authorize', () => ({ value: null }))
  on('http.fetch', () => { throw new Error('must not be called') })
  on('session.measure', (_$, e) => ({ changed: e.changed }))

  await $.session.measure({
    context: { window: 200_000, tokens: 50_000, percent: 25 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ plugin: 'context-band', surface: 'desktop', ...BAND })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('context 25%')
})
