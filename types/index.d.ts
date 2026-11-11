/** A provider that can rewrite. */
export type Rewriter = 'qwen' | 'doubao'

/** What a message shows: the original or one provider's rewrite. */
export type View = 'original' | Rewriter

/** One provider's rewrite of a message. */
export type Rewrite = {
  status: 'pending' | 'done' | 'failed'
  /** The rewritten text, once done. */
  text?: string
  /** Why it failed, once failed. */
  error?: string
}

/** One message, keyed by a hash of its original text. */
export type Entry = {
  /** The original text. */
  source: string
  /** The version picked for this message; absent, the global mode decides. */
  view?: View
  qwen?: Rewrite
  doubao?: Rewrite
}

export type Rewrites = {
  /** Messages by text hash. */
  entries: Record<string, Entry>
  /** Transcript row uuid → text hash. */
  byRow: Record<string, string>
  /** Hashes, oldest first, for trimming. */
  order: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'readable-rewrite-cn': {
      /** original: rewrite on request; a provider: rewrite every reply with it and show that. */
      mode: Shaped<View>
      rewrites: Shaped<Rewrites>
    }
  }
}
