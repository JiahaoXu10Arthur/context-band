import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Figures } from '../types'

const figures = atom({ plugin: 'context-band', key: 'figures' } as const, null)

const LABELS: Record<string, string> = { five_hour: 'session', seven_day: 'weekly' }
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

type UsageBody = {
  limits?: { percent: number; scope: { model: { display_name: string } | null } | null }[]
}

// Per-model weekly windows come only from the OAuth usage endpoint, as the
// `limits[]` entries with a model scope; the response headers that feed
// `rateLimits` carry five_hour and seven_day alone.
async function modelWindows($: EngineInterface): Promise<Figures['models']> {
  const auth = await $.session.authorize()
  if (auth === null) return []
  const r = await $.http.fetch(USAGE_URL, { auth: auth.handle })
  if (!r.ok) return []
  const body = JSON.parse(r.text) as UsageBody
  return (body.limits ?? []).flatMap(l =>
    l.scope?.model ? [{ name: l.scope.model.display_name, percentUsed: l.percent }] : [],
  )
}

async function measure($: EngineInterface, context: SessionContextUsage, rateLimits: SessionRateLimit[]) {
  const next: Figures = {
    contextPercent: context.percent ?? null,
    limits: rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed })),
    models: await modelWindows($),
  }
  await update($, figures, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const u = await $.session.usage()
    await measure($, u.context, u.rateLimits)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e.context, e.rateLimits)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, figures)
    if (f === null || e.props.hasSurvey) return next(e)

    const parts = [
      `context ${f.contextPercent === null ? '--' : `${f.contextPercent}%`}`,
      ...f.limits.map(l => `${LABELS[l.kind] ?? l.kind} ${l.percentUsed}%`),
      ...f.models.map(m => `${m.name} ${m.percentUsed}%`),
    ]
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>{parts.join(' · ')}</Text>
      </Box>
    )
  })
}
