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

const LABELS: Record<string, string> = { five_hour: 'session', seven_day: 'weekly' }
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const MINUTE = 60_000

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

type UsageBody = {
  limits?: { percent: number; scope: { model: { display_name: string } | null } | null }[]
}

// Per-model weekly windows come only from the OAuth usage endpoint, as the
// `limits[]` entries with a model scope; the response headers that feed
// `rateLimits` carry five_hour and seven_day alone.
async function modelWindows($: EngineInterface): Promise<Figures['models']> {
  try {
    const auth = await $.session.authorize()
    if (auth === null) return []
    const r = await $.http.fetch(USAGE_URL, { auth: auth.handle })
    if (!r.ok) return []
    const body = JSON.parse(r.text) as UsageBody
    return (body.limits ?? []).flatMap(l =>
      l.scope?.model ? [{ name: l.scope.model.display_name, percentUsed: l.percent }] : [],
    )
  } catch {
    return []
  }
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
  const next: Figures = {
    now: await $.clock.now(),
    startedAt: show.duration ? (await $.session.usage()).startedAt : null,
    context: {
      percent: u.context.percent ?? null,
      tokens: u.context.tokens ?? null,
      window: u.context.window ?? null,
    },
    limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed, resetsAt: r.resetsAt ?? null })),
    models: show.models ? await modelWindows($) : [],
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
  if (h < 24) return m ? `${h}h${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const hh = h % 24
  return hh ? `${d}d${hh}h` : `${d}d`
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

function line(f: Figures, show: Show): string[] {
  const parts: string[] = []
  if (show.model && f.model !== null) parts.push(f.model)
  if (show.folder && f.folder !== null) parts.push(show.branch && f.branch !== null ? `${f.folder} (${f.branch})` : f.folder)
  else if (show.branch && f.branch !== null) parts.push(f.branch)
  if (show.context) {
    const pct = f.context.percent === null ? '--' : `${f.context.percent}%`
    const size = show.tokens && f.context.tokens !== null && f.context.window !== null
      ? ` (${tokens(f.context.tokens)}/${tokens(f.context.window)})`
      : ''
    parts.push(`context ${pct}${size}`)
  }
  for (const l of f.limits) {
    if ((l.kind === 'five_hour' && !show.session) || (l.kind === 'seven_day' && !show.weekly)) continue
    const reset = show.resets ? until(l.resetsAt, f.now) : null
    parts.push(`${LABELS[l.kind] ?? l.kind} ${l.percentUsed}%${reset === null ? '' : ` (${reset})`}`)
  }
  if (show.models) for (const m of f.models) parts.push(`${m.name} ${m.percentUsed}%`)
  if (show.cost && f.costUsd !== null) parts.push(`$${f.costUsd.toFixed(2)}`)
  if (show.turns && f.turns !== null) parts.push(`${f.turns} ${f.turns === 1 ? 'turn' : 'turns'}`)
  if (show.duration && f.startedAt !== null) parts.push(`elapsed ${span(f.now - f.startedAt)}`)
  if (show.clock) parts.push(clock(f.now))
  return parts
}

export const register: Register = (on, options) => {
  const show = showing(options)

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
        <Text dimColor>{parts.join(' · ')}</Text>
      </Box>
    )
  })
}
