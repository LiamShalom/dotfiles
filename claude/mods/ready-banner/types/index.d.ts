export type BannerMode = 'ready' | 'merged' | 'waiting' | null

declare module 'claude-code' {
  interface PluginState {
    'ready-banner': { mode: BannerMode; hasMerged: boolean; hasAnswered: boolean; background: { agents: number; isCiRunning: boolean }; waitingLabel: string; codexIds: string[] }
  }
}
