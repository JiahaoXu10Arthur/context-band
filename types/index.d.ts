export type Figures = {
  contextPercent: number | null
  limits: { kind: string; percentUsed: number }[]
  models: { name: string; percentUsed: number }[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-band': { figures: Figures | null }
  }
}
