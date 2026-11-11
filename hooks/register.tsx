import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Entry, Rewrite, Rewriter, Rewrites, View } from '../types'
import { ACTIONS, takeActions } from './actions'

/**
 * One OpenAI-compatible chat-completions provider per button. Its key, model,
 * base URL and extra request fields are userConfig options named `<prefix>_*`.
 * With `<prefix>_api_key` empty, the key is the `keyEnv` line of `ENV_FILE`
 * (kept outside the installed copy, which holds only committed files), else the
 * environment variable of that name (see `envKey`: `$.env.get` takes only a
 * literal name).
 * To add a provider: add a row here, its four options to plugin.json, its
 * variable to `envKey`, and its name to `Rewriter` and `Entry` in types/index.d.ts.
 */
const MODELS: Record<Rewriter, { label: string; color: string; prefix: string; keyEnv: string }> = {
  qwen: { label: '通义', color: 'suggestion', prefix: 'qwen', keyEnv: 'DASHSCOPE_API_KEY' },
  doubao: { label: '豆包', color: 'merged', prefix: 'ark', keyEnv: 'ARK_API_KEY' },
}
const REWRITERS = Object.keys(MODELS) as Rewriter[]
/** Under the home directory: this plugin's data folder, which updates keep. */
const ENV_FILE = '.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env'
/** Blocks shorter than this are shown as written. */
const MIN_CHARS = 60
const KEEP = 400

const modeAtom = atom({ plugin: 'readable-rewrite-cn', key: 'mode' } as const, 'original' as View, {
  shape: 'mode-1',
})
const rewritesAtom = atom(
  { plugin: 'readable-rewrite-cn', key: 'rewrites' } as const,
  { entries: {}, byRow: {}, order: [] } as Rewrites,
  { shape: 'rewrites-1' },
)

async function hashOf(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.trim())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest).slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n\n')
}

function setEntry(r: Rewrites, hash: string, entry: Entry): Rewrites {
  const entries = { ...r.entries, [hash]: entry }
  let order = r.order.includes(hash) ? r.order : [...r.order, hash]
  let byRow = r.byRow
  if (order.length > KEEP) {
    const dropped = new Set(order.slice(0, order.length - KEEP))
    order = order.slice(-KEEP)
    for (const h of dropped) delete entries[h]
    byRow = Object.fromEntries(Object.entries(byRow).filter(([, h]) => !dropped.has(h)))
  }
  return { entries, byRow, order }
}

function setRewrite(r: Rewrites, hash: string, model: Rewriter, rewrite: Rewrite): Rewrites {
  const one = r.entries[hash]
  return one ? setEntry(r, hash, { ...one, [model]: rewrite }) : r
}

type Attempt = Rewrite & { isRetryable?: boolean }

function str(options: PluginOptions, key: string): string {
  const v = options[key]
  return typeof v === 'string' ? v.trim() : ''
}

/** Strips one code fence the model may have wrapped the whole answer in. */
function unfence(text: string): string {
  const t = text.trim()
  const m = t.match(/^```[\w-]*\n([\s\S]*?)\n```$/)
  return (m?.[1] ?? t).trim()
}

/** `NAME=value` lines of `ENV_FILE`; empty when it is missing. */
async function dotenv($: EngineInterface): Promise<Record<string, string>> {
  let text: string
  try {
    const home = await $.env.get('HOME')
    if (!home) return {}
    text = await $.fs.read(`${home}/${ENV_FILE}`)
  } catch {
    return {}
  }
  const vars: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/)
    if (!m?.[1]) continue
    const value = m[2] ?? ''
    vars[m[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value
  }
  return vars
}

/** The provider's key from the environment, when the option and `.env` have none. */
async function envKey($: EngineInterface, model: Rewriter): Promise<string> {
  try {
    const value = model === 'qwen' ? await $.env.get('DASHSCOPE_API_KEY') : await $.env.get('ARK_API_KEY')
    return (value ?? '').trim()
  } catch {
    return ''
  }
}

async function attempt($: EngineInterface, options: PluginOptions, model: Rewriter, original: string): Promise<Attempt> {
  const { label, prefix, keyEnv } = MODELS[model]
  const apiKey = str(options, `${prefix}_api_key`) || (await dotenv($))[keyEnv]?.trim() || (await envKey($, model))
  const modelId = str(options, `${prefix}_model`)
  const baseUrl = str(options, `${prefix}_base_url`).replace(/\/+$/, '')
  if (!apiKey || !modelId || !baseUrl)
    return { status: 'failed', error: `${label} 未配置 ${!apiKey ? `API Key（${prefix}_api_key、.env 或环境变量 ${keyEnv}）` : !modelId ? '模型 ID' : 'Base URL'}，见 README「配置」` }

  let extra: Record<string, unknown> = {}
  const extraRaw = str(options, `${prefix}_extra_body`)
  if (extraRaw) {
    try {
      extra = JSON.parse(extraRaw)
    } catch {
      return { status: 'failed', error: `${prefix}_extra_body 不是合法 JSON` }
    }
  }
  const template = str(options, 'user_template') || '{{text}}'
  const system = str(options, 'system_prompt')
  const body = {
    ...extra,
    model: modelId,
    stream: false,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: template.includes('{{text}}') ? template.split('{{text}}').join(original) : `${template}\n\n${original}` },
    ],
  }

  const seconds = typeof options.timeout_seconds === 'number' && options.timeout_seconds > 0 ? options.timeout_seconds : 120
  let timer: { cancel: () => void } | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = $.clock.after(seconds * 1000, () => resolve('timeout'))
  })
  try {
    const r = await Promise.race([
      $.http.fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      }),
      timeout,
    ])
    if (r === 'timeout') return { status: 'failed', error: `请求超时（${seconds} 秒）`, isRetryable: true }
    let json: { choices?: { message?: { content?: unknown } }[]; error?: { message?: string } } = {}
    try {
      json = JSON.parse(r.text)
    } catch {}
    if (!r.ok) {
      const why = json.error?.message ?? r.text.slice(0, 200)
      return { status: 'failed', error: `API 错误 ${r.status} ${why}`, isRetryable: r.status === 429 || r.status >= 500 }
    }
    const content = json.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? unfence(content) : ''
    return text ? { status: 'done', text } : { status: 'failed', error: '模型返回空文本' }
  } catch (err) {
    return { status: 'failed', error: `请求失败：${err instanceof Error ? err.message : String(err)}`, isRetryable: true }
  } finally {
    timer?.cancel()
  }
}

async function rewrite($: EngineInterface, options: PluginOptions, hash: string, model: Rewriter, original: string) {
  let result = await attempt($, options, model, original)
  if (result.isRetryable) result = await attempt($, options, model, original)
  const { isRetryable: _, ...done } = result
  await update($, rewritesAtom, cur => setRewrite(cur, hash, model, done))
}

/** Starts a model's rewrite unless it is done or under way. */
async function ensureRewrite($: EngineInterface, options: PluginOptions, hash: string, model: Rewriter) {
  let source: string | undefined
  await update($, rewritesAtom, cur => {
    const one = cur.entries[hash]
    const status = one?.[model]?.status
    if (!one || status === 'pending' || status === 'done') return cur
    source = one.source
    return setRewrite(cur, hash, model, { status: 'pending' })
  })
  if (source) await rewrite($, options, hash, model, source)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'readable',
      description: '改写回复：/readable off（点按钮才改写，默认）| qwen | doubao（每条回复自动改写）',
    })
    // A reload drops calls in flight: offer a retry for whatever was still pending.
    await update($, rewritesAtom, cur => {
      let out = cur
      for (const [hash, one] of Object.entries(cur.entries))
        for (const model of REWRITERS)
          if (one[model]?.status === 'pending')
            out = setRewrite(out, hash, model, { status: 'failed', error: 'mod 重新加载，请求中断' })
      return out
    })
    return next(e)
  })

  on('command.run', { command: 'readable' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const picked: View | undefined =
      arg === 'off' ? 'original' : arg === 'qwen' || arg === 'doubao' ? arg : undefined
    if (!picked) {
      const cur = await read($, modeAtom)
      return {
        text: `当前：${cur === 'original' ? '默认显示原文，点按钮才改写' : `每条回复自动用 ${MODELS[cur].label} 改写`}。用法：/readable off | qwen | doubao`,
      }
    }
    await update($, modeAtom, () => picked)
    return {
      text:
        picked === 'original'
          ? '默认显示原文，点按钮才改写。'
          : `之后的每条回复都会自动用 ${MODELS[picked].label} 改写，默认显示改写版。`,
    }
  })

  // Observe the model's reply rows as they are stored; the row itself goes on
  // unchanged, so the model's context keeps the original.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId || e.message.type !== 'assistant') return stored
    const original = textOf(e.message.content)
    if (original.trim().length < MIN_CHARS) return stored

    const hash = await hashOf(original)
    const mode = await read($, modeAtom)
    const auto = mode === 'original' ? undefined : mode
    let isNew = false
    await update($, rewritesAtom, cur => {
      isNew = !cur.entries[hash]
      const withRow = { ...cur, byRow: { ...cur.byRow, [e.uuid]: hash } }
      if (!isNew) return withRow
      const entry: Entry = { source: original, ...(auto ? { [auto]: { status: 'pending' } } : {}) }
      return setEntry(withRow, hash, entry)
    })
    if (isNew && auto) void rewrite($, options, hash, auto, original)
    return stored
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const rewrites = await read($, rewritesAtom)
    const hash = rewrites.byRow[e.requestId] ?? (await hashOf(e.props.text))
    // A reply stored before the mod loaded (or before a reload reset its
    // cache) has no entry yet: offer the buttons anyway, from its drawn text.
    const entry: Entry | undefined =
      rewrites.entries[hash] ?? (e.props.text.trim().length >= MIN_CHARS ? { source: e.props.text } : undefined)
    if (!entry) return next(e)

    const mode = await read($, modeAtom)
    const { Box, Text, Button } = $.ui.resolve(e)
    // The global mode picks a provider only for a reply that has its rewrite:
    // one stored before the mode was set stays the original until pressed.
    const view: View = entry.view ?? (mode !== 'original' && entry[mode] ? mode : 'original')
    const shown = view === 'original' ? undefined : entry[view]

    // Each provider's button is a toggle: lit while its rewrite is shown,
    // pressed again back to the original. A failed one retries instead.
    const press = (model: Rewriter) => async () => {
      const pick: View = view === model && shown?.status !== 'failed' ? 'original' : model
      await update($, rewritesAtom, cur => {
        const one = cur.entries[hash] ?? { source: entry.source }
        return setEntry({ ...cur, byRow: { ...cur.byRow, [e.requestId]: hash } }, hash, { ...one, view: pick })
      })
      if (pick !== 'original') $.clock.after(0, () => void ensureRewrite($, options, hash, pick))
    }
    const status =
      view !== 'original' && shown?.status === 'pending' ? (
        <Text size="caption" color="subtle">
          {MODELS[view].label} 改写中…
        </Text>
      ) : view !== 'original' && shown?.status === 'failed' ? (
        <Text size="caption" color="warning">
          {MODELS[view].label} 改写失败（{shown.error ?? '未知原因'}），再点一次重试
        </Text>
      ) : null
    const isRewritten = view !== 'original' && shown?.status === 'done' && !!shown.text
    const drawn = isRewritten && shown?.text ? await next({ ...e, props: { ...e.props, text: shown.text } }) : await next(e)
    // Another plugin's buttons under this reply join these on a single row.
    const { rest, actions } = takeActions(drawn)
    const switcher = (
      <Box key={ACTIONS} flexDirection="row" gap={1} marginTop={1} alignItems="center">
        {actions}
        {REWRITERS.map(model => (
          <Button
            key={`show-${model}-${hash}`}
            label={`${MODELS[model].label} 改写`}
            variant={view === model ? 'primary' : 'secondary'}
            onPress={press(model)}
          />
        ))}
        {status}
      </Box>
    )

    if (!isRewritten) {
      return (
        <Box flexDirection="column">
          {rest}
          {switcher}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={MODELS[view].color} paddingX={1}>
          <Text size="caption" color={MODELS[view].color}>
            {MODELS[view].label} 改写
          </Text>
          {rest}
        </Box>
        {switcher}
      </Box>
    )
  })
}
