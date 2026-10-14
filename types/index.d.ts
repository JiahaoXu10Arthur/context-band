export type Figures = {
  /** When the figures were read, in epoch milliseconds; moved on by the minute tick. */
  now: number
  /** When the session started, in epoch milliseconds; null unless the duration is shown. */
  startedAt: number | null
  context: { percent: number | null; tokens: number | null; window: number | null }
  limits: { kind: string; percentUsed: number; resetsAt: string | null }[]
  models: { name: string; percentUsed: number }[]
  costUsd: number | null
  turns: number | null
  model: string | null
  folder: string | null
  branch: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'context-band': { figures: Figures | null }
  }
}
