import { expect, mock, test } from 'claude-code/testing'
import type { HttpResponse, On } from 'claude-code'

const ORIGINAL =
  'Kevin，代码和 11-09 实战日志已读完，正在复现一个疑似问题（`--want` 模式下等待期输出被缓冲），随后整理结论。'
const BY_QWEN = '代码和日志都看完了。（通义）'
const BY_DOUBAO = '代码和日志都看完了。（豆包）'

const OPTIONS = {
  qwen_api_key: 'test-qwen-key',
  qwen_model: 'test-qwen-model',
  ark_api_key: 'test-ark-key',
  ark_model: 'ep-test',
}

type Ask = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

function engine(
  on: On,
  answer?: (ask: Ask, calls: number) => HttpResponse | undefined,
  env: Record<string, string> = {},
  dotenv?: string,
) {
  const asks: Ask[] = []
  mock.env(on, env)
  // No `.env` unless a test gives one: the read then rejects, as for a missing file.
  const reads: string[] = []
  if (dotenv !== undefined)
    on('fs.read', (_, e) => {
      reads.push(e.path)
      return { value: dotenv }
    })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'readable' } }))
  on('command.run', () => ({ text: '' }))
  on('http.fetch', (_, e) => {
    const ask = { url: e.url, headers: e.init?.headers ?? {}, body: JSON.parse(String(e.init?.body)) }
    asks.push(ask)
    const custom = answer?.(ask, asks.length)
    if (custom) return { value: custom }
    const text = e.url.includes('volces') ? BY_DOUBAO : BY_QWEN
    return {
      value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ choices: [{ message: { content: text } }] }) },
    }
  })
  // Stands for the engine's own drawing of a reply block.
  on('ui.render', ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={(e.props as { text: string }).text} />
  })
  return { asks, reads, clock: mock.clock(on), session: mock.session(on) }
}

function reply(uuid: string, text = ORIGINAL, agentId?: string) {
  return {
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid,
    ...(agentId ? { agentId } : {}),
  } as never
}

function block(surface: 'desktop' | 'terminal', requestId: string) {
  return {
    plugin: 'readable-rewrite-cn',
    surface,
    component: 'AssistantMessage',
    requestId,
    props: { text: ORIGINAL, isFirstOfReply: true },
  } as never
}

type Drawing = { find: (q: { type: string; text: string | RegExp }) => Promise<unknown>; press: (q: { key: string }) => Promise<unknown> }
async function press(ui: Drawing, label: string) {
  const button = (await ui.find({ type: 'Button', text: label })) as { key: string }
  await ui.press({ key: button.key })
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`two toggles; each provider rewrites only when asked (${surface})`, { options: OPTIONS }, async ($, on) => {
    const { asks, clock, session } = engine(on)
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.session.append(reply('row-1'))
    await clock.settle()
    expect(asks).toEqual([])

    const ui = await $.ui.mount(block(surface, 'row-1'))
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain(ORIGINAL)
    expect(await ui.find({ type: 'Button', text: '原文' })).toBeFalsy()
    expect(JSON.stringify(await ui.find({ type: 'Button', text: '通义 改写' }))).toContain('secondary')

    await press(ui, '通义 改写')
    await clock.settle()
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain(BY_QWEN)
    expect(JSON.stringify(await ui.find({ type: 'Button', text: '通义 改写' }))).toContain('primary')

    // Pressing the other provider switches to it.
    await press(ui, '豆包 改写')
    await clock.settle()
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain(BY_DOUBAO)
    expect(JSON.stringify(await ui.find({ type: 'Button', text: '通义 改写' }))).toContain('secondary')
    expect(asks.map(a => a.url)).toEqual([
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    ])

    // Pressing the lit one again goes back to the original; cached, no new calls.
    await press(ui, '豆包 改写')
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain(ORIGINAL)
    expect(JSON.stringify(await ui.find({ type: 'Button', text: '豆包 改写' }))).toContain('secondary')
    await press(ui, '通义 改写')
    await clock.settle()
    expect((await ui.find({ type: 'Markdown' }))?.text).toContain(BY_QWEN)
    expect(asks.length).toBe(2)
    await ui.unmount()

    // The stored row — what the model reads next turn — is the original.
    const stored = JSON.stringify(session.appended())
    expect(stored).toContain(ORIGINAL)
    expect(stored).not.toContain(BY_QWEN)
    expect(stored).not.toContain(BY_DOUBAO)
  })
}

test('request carries key, model, prompts and extra body', { options: OPTIONS }, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.append(reply('row-r'))
  const ui = await $.ui.mount(block('desktop', 'row-r'))
  await press(ui, '通义 改写')
  await press(ui, '豆包 改写')
  await clock.settle()
  const [qwen, doubao] = asks
  if (!qwen || !doubao) throw new Error('expected two requests')
  expect(qwen.headers.Authorization).toBe('Bearer test-qwen-key')
  expect(qwen.body.model).toBe('test-qwen-model')
  expect(qwen.body.enable_thinking).toBe(false)
  const messages = qwen.body.messages as { role: string; content: string }[]
  expect(messages[0]).toEqual({ role: 'system', content: '你是一名润色专家，擅长将晦涩复杂的文本转化为清晰、易于理解的表达。' })
  expect(messages[1]?.role).toBe('user')
  expect(messages[1]?.content).toContain(`<原文>\n${ORIGINAL}\n</原文>`)
  expect(messages[1]?.content).toContain('只返回改写后的文字')
  expect(doubao.headers.Authorization).toBe('Bearer test-ark-key')
  expect(doubao.body.model).toBe('ep-test')
  expect(doubao.body.thinking).toEqual({ type: 'disabled' })
  await ui.unmount()
})

test('/readable doubao rewrites each new main-thread reply up front', { options: OPTIONS }, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'readable', args: 'doubao' } as never)
  await $.session.append(reply('row-a'))
  await $.session.append(reply('row-short', '好的。'))
  await $.session.append(reply('row-sub', ORIGINAL + '子代理', 'a1'))
  await clock.settle()
  expect(asks.length).toBe(1)
  expect(asks[0]?.body.model).toBe('ep-test')

  const ui = await $.ui.mount(block('desktop', 'row-a'))
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain(BY_DOUBAO)
  await ui.unmount()
})

test('a failed rewrite shows its reason; pressing again retries', { options: OPTIONS }, async ($, on) => {
  // 401 is not retried on its own: one call per press.
  const { asks, clock } = engine(on, (_, calls) =>
    calls === 1 ? { status: 401, ok: false, headers: {}, text: JSON.stringify({ error: { message: 'invalid api key' } }) } : undefined,
  )
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.append(reply('row-f'))
  const ui = await $.ui.mount(block('desktop', 'row-f'))
  await press(ui, '通义 改写')
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /401/ }))?.text).toContain('invalid api key')
  expect(asks.length).toBe(1)

  await press(ui, '通义 改写')
  await clock.settle()
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain(BY_QWEN)
  await ui.unmount()
})

test('a fenced answer is unwrapped', { options: OPTIONS }, async ($, on) => {
  const { clock } = engine(on, () => ({
    status: 200,
    ok: true,
    headers: {},
    text: JSON.stringify({ choices: [{ message: { content: '```\n' + BY_QWEN + '\n```' } }] }),
  }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(block('desktop', 'row-fence'))
  await press(ui, '通义 改写')
  await clock.settle()
  const text = String(((await ui.find({ type: 'Markdown' })) as { text: string }).text)
  expect(text).toContain(BY_QWEN)
  expect(text).not.toContain('```')
  await ui.unmount()
})

test('a provider with no key says so and sends nothing', { options: { ...OPTIONS, ark_api_key: '' } }, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(block('desktop', 'row-nokey'))
  await press(ui, '豆包 改写')
  await clock.settle()
  expect(asks).toEqual([])
  expect((await ui.find({ type: 'Text', text: /未配置/ }))?.text).toContain('ARK_API_KEY')
  await ui.unmount()
})

test('an empty key option falls back to the environment variable', { options: { ...OPTIONS, qwen_api_key: '' } }, async ($, on) => {
  const { asks, clock } = engine(on, undefined, { DASHSCOPE_API_KEY: 'key-from-env' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(block('desktop', 'row-env'))
  await press(ui, '通义 改写')
  await clock.settle()
  expect(asks[0]?.headers.Authorization).toBe('Bearer key-from-env')
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain(BY_QWEN)
  await ui.unmount()
})

test('an empty key option reads the data-folder .env before the environment', { options: { ...OPTIONS, qwen_api_key: '', ark_api_key: '' } }, async ($, on) => {
  const dotenv = '# keys\nexport DASHSCOPE_API_KEY="key-from-dotenv"\nARK_API_KEY = \'ark-from-dotenv\'\n'
  const env = { DASHSCOPE_API_KEY: 'key-from-env', HOME: '/Users/k' }
  const { asks, reads, clock } = engine(on, undefined, env, dotenv)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(block('desktop', 'row-dotenv'))
  await press(ui, '通义 改写')
  await clock.settle()
  await press(ui, '豆包 改写')
  await clock.settle()
  expect(asks.map((a) => a.headers.Authorization)).toEqual(['Bearer key-from-dotenv', 'Bearer ark-from-dotenv'])
  expect(reads[0]).toBe('/Users/k/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env')
  await ui.unmount()
})

test('a short reply gets no buttons', { options: OPTIONS }, async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({
    plugin: 'readable-rewrite-cn',
    surface: 'desktop',
    component: 'AssistantMessage',
    requestId: 'row-tiny',
    props: { text: '好的。', isFirstOfReply: true },
  } as never)
  expect(await ui.find({ type: 'Button', text: '通义 改写' })).toBeFalsy()
  await ui.unmount()
})

test('another plugin\'s reply buttons join these on a single row', { options: OPTIONS }, async ($, on) => {
  let otherPressed = 0
  // Stands for a plugin beneath (zh-en-bridge) that keys its row `reply-actions`.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Box, Button, Markdown } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Markdown text={e.props.text} />
        <Box key="reply-actions" flexDirection="row" gap={1} marginTop={1}>
          <Button key="other-translate" label="中文译文" onPress={() => void otherPressed++} />
        </Box>
      </Box>
    )
  })
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount(block('desktop', 'row-j'))
  const rows = (await ui.findAll({ type: 'Box', key: 'reply-actions' })) as { props: Record<string, unknown> }[]
  expect(rows.length).toBe(2)
  const outer = JSON.stringify(rows[0])
  expect(outer.indexOf('中文译文')).toBeGreaterThan(-1)
  expect(outer.indexOf('通义 改写')).toBeGreaterThan(outer.indexOf('中文译文'))
  expect(rows[1]?.props.marginTop).toBeUndefined()
  await ui.press({ key: 'other-translate', plugin: 'test' })
  expect(otherPressed).toBe(1)
  await ui.unmount()
})

test('/readable qwen leaves an earlier reply on the original until its button is pressed', { options: OPTIONS }, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.append(reply('row-old'))
  await $.command.run({ command: 'readable', args: 'qwen' } as never)
  await clock.settle()
  const ui = await $.ui.mount(block('desktop', 'row-old'))
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain(ORIGINAL)
  expect(JSON.stringify(await ui.find({ type: 'Button', text: '通义 改写' }))).toContain('secondary')
  expect(asks).toEqual([])

  // One press rewrites it.
  await press(ui, '通义 改写')
  await clock.settle()
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain(BY_QWEN)
  expect(asks.length).toBe(1)
  await ui.unmount()
})

test('a user_template without {{text}} gets the reply appended', { options: { ...OPTIONS, user_template: '把下面的文字改写得更易读' } }, async ($, on) => {
  const { asks, clock } = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.append(reply('row-t'))
  const ui = await $.ui.mount(block('desktop', 'row-t'))
  await press(ui, '通义 改写')
  await clock.settle()
  const messages = asks[0]?.body.messages as { role: string; content: string }[]
  expect(messages[1]?.content).toBe(`把下面的文字改写得更易读\n\n${ORIGINAL}`)
  await ui.unmount()
})
