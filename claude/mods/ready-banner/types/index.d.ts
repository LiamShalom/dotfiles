export type BannerMode = 'ready' | 'merged' | null

declare module 'claude-code' {
  interface PluginState {
    'ready-banner': { mode: BannerMode; hasMerged: boolean; hasAnswered: boolean; isWaiting: boolean }
  }
}
