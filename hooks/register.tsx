import { atom, read, update } from 'claude-code'
import type {
  EngineInterface,
  PluginOptions,
  Register,
  SessionContextUsage,
  SessionCost,
  SessionRateLimit,
} from 'claude-code'

import type { Figures } from '../types'

const figures = atom({ plugin: 'context-band', key: 'figures' } as const, null)

const LABELS: Record<string, string> = { five_hour: 'Session', seven_day: 'Weekly' }
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const MINUTE = 60_000
const MODELS_EVERY = 5 * MINUTE
const MODELS_RETRY = MINUTE
const MODELS_SOON = 10_000

// Every part of the line, in the order it is drawn. Each is a boolean field of
// the manifest's userConfig: a row in /config, and a screen at install time.
const PARTS = [
  'model', 'folder', 'branch',
  'context', 'tokens', 'session', 'weekly', 'resets', 'models',
  'cost', 'turns', 'duration', 'clock',
] as const
type Part = (typeof PARTS)[number]
type Show = Record<Part, boolean>

function showing(options: PluginOptions): Show {
  const show = {} as Show
  for (const p of PARTS) show[p] = options[p] === true
  return show
}

// The line's colors: the base one, and the two a figure turns to at and
// above the warn and high percentages.
type Style = { color: string; warnAt: number; warnColor: string; highAt: number; highColor: string }

function styling(options: PluginOptions): Style {
  return {
    color: String(options.color),
    warnAt: Number(options.warnAt),
    warnColor: String(options.warnColor),
    highAt: Number(options.highAt),
    highColor: String(options.highColor),
  }
}

function tone(percent: number | null, style: Style): string {
  if (percent === null) return style.color
  if (percent >= style.highAt) return style.highColor
  if (percent >= style.warnAt) return style.warnColor
  return style.color
}

type UsageBody = {
  limits?: { percent: number; resets_at?: string | null; scope: { model: { display_name: string } | null } | null }[]
}

// Per-model weekly windows come only from the OAuth usage endpoint, as the
// `limits[]` entries with a model scope; the response headers that feed
// `rateLimits` carry five_hour and seven_day alone. Null when the request
// failed (a 429 among them): the caller keeps the reading it has.
async function modelWindows($: EngineInterface): Promise<Figures['models'] | null> {
  try {
    const auth = await $.session.authorize()
    if (auth === null) return []
    const r = await $.http.fetch(USAGE_URL, { auth: auth.handle })
    if (!r.ok) return null
    const body = JSON.parse(r.text) as UsageBody
    return (body.limits ?? []).flatMap(l =>
      l.scope?.model ? [{ name: l.scope.model.display_name, percentUsed: l.percent, resetsAt: l.resets_at ?? null }] : [],
    )
  } catch {
    return null
  }
}

// The endpoint is asked again MODELS_EVERY after a reading, MODELS_RETRY
// after a failed request; in between the last reading stands. A failed
// request is also tried once more MODELS_SOON later, off the clock, so a
// reload that collides with the engine's own request (a 429) shows the
// entry within seconds instead of after the next turn.
let modelsDueAt = -Infinity
let models: Figures['models'] = []
let soonRetry = false

async function modelWindowsCached($: EngineInterface, now: number): Promise<Figures['models']> {
  if (now >= modelsDueAt) {
    const fresh = await modelWindows($)
    if (fresh !== null) models = fresh
    modelsDueAt = now + (fresh === null ? MODELS_RETRY : MODELS_EVERY)
    if (fresh === null && !soonRetry) {
      soonRetry = true
      $.clock.after(MODELS_SOON, async () => {
        soonRetry = false
        const again = await modelWindows($)
        if (again === null) return
        models = again
        modelsDueAt = (await $.clock.now()) + MODELS_EVERY
        await update($, figures, f => (f === null ? f : { ...f, models: again }))
      })
    }
  }
  return models
}

function parentOf(dir: string): string | null {
  const parent = dir.replace(/[\\/][^\\/]*$/, '')
  return parent === dir || parent === '' ? null : parent
}

function basename(dir: string): string {
  const m = /[^\\/]+$/.exec(dir)
  return m ? m[0] : dir
}

// The branch of the repository `cwd` is in: `.git/HEAD` of the nearest `.git`
// upward, following a worktree's `gitdir:` file. Null outside a repository.
async function gitBranch($: EngineInterface, cwd: string): Promise<string | null> {
  try {
    for (let dir: string | null = cwd; dir !== null; dir = parentOf(dir)) {
      const dotGit = `${dir}/.git`
      if (!(await $.fs.exists(dotGit))) continue
      let gitDir = dotGit
      if ((await $.fs.stat(dotGit)).kind === 'file') {
        const m = /^gitdir:\s*(.+)$/m.exec(await $.fs.read(dotGit))
        if (!m) return null
        const target = m[1]!.trim()
        gitDir = /^([a-zA-Z]:)?[\\/]/.test(target) ? target : `${dir}/${target}`
      }
      const head = (await $.fs.read(`${gitDir}/HEAD`)).trim()
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
      return ref ? ref[1]! : head.slice(0, 7)
    }
  } catch {
    // unreadable repository: no branch
  }
  return null
}

type Reading = { context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }

async function measure($: EngineInterface, show: Show, u: Reading) {
  const cwd = show.folder || show.branch ? await $.session.cwd() : null
  const now = await $.clock.now()
  const next: Figures = {
    now,
    startedAt: show.duration ? (await $.session.usage()).startedAt : null,
    context: {
      percent: u.context.percent ?? null,
      tokens: u.context.tokens ?? null,
      window: u.context.window ?? null,
    },
    limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
    models: show.models ? await modelWindowsCached($, now) : [],
    costUsd: u.cost?.usd ?? null,
    turns: show.turns ? await $.session.turns() : null,
    model: show.model ? await $.session.model() : null,
    folder: cwd !== null && show.folder ? basename(cwd) : null,
    branch: cwd !== null && show.branch ? await gitBranch($, cwd) : null,
  }
  await update($, figures, () => next)
}

function span(ms: number): string {
  const mins = Math.max(0, Math.round(ms / MINUTE))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return m ? `${h}hr ${m}m` : `${h}hr`
  const d = Math.floor(h / 24)
  const hh = h % 24
  return hh ? `${d}d ${hh}hr` : `${d}d`
}

function until(resetsAt: string | null, now: number): string | null {
  if (resetsAt === null) return null
  const ms = Date.parse(resetsAt) - now
  return Number.isFinite(ms) && ms > 0 ? span(ms) : null
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return `${n}`
}

function clock(now: number): string {
  const d = new Date(now)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

type Piece = { text: string; percent: number | null }

function line(f: Figures, show: Show): Piece[] {
  const parts: Piece[] = []
  const plain = (text: string) => parts.push({ text, percent: null })
  if (show.model && f.model !== null) plain(f.model)
  if (show.folder && f.folder !== null) plain(show.branch && f.branch !== null ? `${f.folder} (${f.branch})` : f.folder)
  else if (show.branch && f.branch !== null) plain(f.branch)
  if (show.context) {
    const pct = f.context.percent === null ? '--' : `${f.context.percent}%`
    const size = show.tokens && f.context.tokens !== null && f.context.window !== null
      ? ` (${tokens(f.context.tokens)}/${tokens(f.context.window)})`
      : ''
    parts.push({ text: `Context ${pct}${size}`, percent: f.context.percent })
  }
  for (const l of f.limits) {
    if ((l.kind === 'five_hour' && !show.session) || (l.kind === 'seven_day' && !show.weekly)) continue
    const reset = show.resets ? until(l.resetsAt, f.now) : null
    parts.push({ text: `${LABELS[l.kind] ?? l.kind} ${l.percentUsed}%${reset === null ? '' : ` (${reset})`}`, percent: l.percentUsed })
  }
  if (show.models) {
    for (const m of f.models) {
      const reset = show.resets ? until(m.resetsAt, f.now) : null
      parts.push({ text: `${m.name} ${m.percentUsed}%${reset === null ? '' : ` (${reset})`}`, percent: m.percentUsed })
    }
  }
  if (show.cost && f.costUsd !== null) plain(`$${f.costUsd.toFixed(2)}`)
  if (show.turns && f.turns !== null) plain(`${f.turns} ${f.turns === 1 ? 'turn' : 'turns'}`)
  if (show.duration && f.startedAt !== null) plain(`Elapsed ${span(f.now - f.startedAt)}`)
  if (show.clock) plain(clock(f.now))
  return parts
}

export const register: Register = (on, options) => {
  const show = showing(options)
  const style = styling(options)

  on('session.start', async ($, e, next) => {
    await measure($, show, await $.session.usage())
    if (show.clock || show.duration) {
      $.clock.every(MINUTE, async () => {
        const now = await $.clock.now()
        await update($, figures, f => (f === null ? f : { ...f, now }))
      })
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, show, e)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, figures)
    if (f === null || e.props.hasSurvey) return next(e)
    const parts = line(f, show)
    if (parts.length === 0) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color={style.color}>
          {parts.map((p, i) => [i === 0 ? '' : ' · ', <Text color={tone(p.percent, style)}>{p.text}</Text>])}
        </Text>
      </Box>
    )
  })
}
