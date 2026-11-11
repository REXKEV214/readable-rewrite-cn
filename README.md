# readable-rewrite-cn

English | [简体中文](README.zh-CN.md)

A Claude Code plugin that rewrites Claude's replies into plain, easy-to-read Chinese using your own Qwen (Alibaba Cloud Model Studio / DashScope) or Doubao (Volcengine Ark) API. The rewrite is shown in the UI only; the conversation history, and therefore Claude's context, keeps the original reply.

## Why

When Claude Code answers in Chinese, the replies are often dense: long sentences, stacked jargon and translated-sounding phrasing. Reading them takes more effort than it should. A small, inexpensive Chinese model is good at restating such text in plainer language, and doing it on the display side means:

- Claude's context is untouched, so the rewrite never affects later turns;
- no Claude tokens are spent on rewriting;
- you choose when to rewrite, and you can flip back to the original at any time.

## Features

- Two toggle buttons under each assistant reply: **通义 改写** (Qwen) and **豆包 改写** (Doubao). Turn one on to see that model's rewrite; turn it off to see the original.
- Rewrites are cached per model by a hash of the original text, so switching back and forth does not resend requests.
- Optional auto mode: `/readable qwen` or `/readable doubao` rewrites every new reply automatically.
- Replies shorter than 60 characters and subagent output are skipped.
- Any OpenAI-compatible `/chat/completions` endpoint can be added as another provider.
- Works side by side with [zh-en-bridge](https://github.com/REXKEV214/zh-en-bridge): both plugins put their buttons in the same row under a reply.

## Requirements

- Claude Code (terminal or desktop app) with plugin support.
- An API key and model ID for at least one of: [Alibaba Cloud Model Studio (DashScope)](https://bailian.console.aliyun.com/) or [Volcengine Ark](https://console.volcengine.com/ark).

## Installation

```bash
claude plugin install readable-rewrite-cn --marketplace REXKEV214/readable-rewrite-cn --scope user
```

Then configure a key and model ID (below) and start a new session.

## Configuration

Settings live in `userConfig` in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json):

| Key | Description | Default |
|---|---|---|
| `qwen_api_key` | Qwen API key, stored in the system keychain | empty |
| `qwen_model` | Qwen model ID, copied from the Model Studio console | empty |
| `qwen_base_url` | Qwen OpenAI-compatible base URL | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `qwen_extra_body` | JSON merged into the request body | `{"enable_thinking": false}` |
| `ark_api_key` | Volcengine Ark API key, stored in the system keychain | empty |
| `ark_model` | Doubao model ID or endpoint ID `ep-xxx` | empty |
| `ark_base_url` | Ark OpenAI-compatible base URL | `https://ark.cn-beijing.volces.com/api/v3` |
| `ark_extra_body` | JSON merged into the request body | `{"thinking": {"type": "disabled"}}` |
| `system_prompt` | System prompt sent to the rewriting model | see `plugin.json` |
| `user_template` | User prompt template; `{{text}}` is replaced with the reply | see `plugin.json` |
| `timeout_seconds` | Per-request timeout in seconds | `120` |

Until a key and model ID are set, pressing a button shows a "not configured" message and sends nothing. The `*_extra_body` defaults turn off thinking mode; clear them if your model rejects those parameters. If `user_template` has no `{{text}}`, the reply is appended after it.

Set values from the command line (the key stays out of your shell history; keys you omit keep their current values):

```bash
claude plugin configure readable-rewrite-cn@readable-rewrite-cn --values-stdin <<'EOF'
{"qwen_api_key": "sk-...", "qwen_model": "your-qwen-model-id", "ark_api_key": "...", "ark_model": "ep-..."}
EOF
```

Non-sensitive fields (model IDs, URLs, prompts) also appear in Claude Code's `/config` menu.

### Where the API key is read from

1. The `qwen_api_key` / `ark_api_key` settings (system keychain);
2. `DASHSCOPE_API_KEY` / `ARK_API_KEY` in `~/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env`;
3. Environment variables of the same names.

To use a `.env` file:

```bash
mkdir -p ~/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn
cp .env.example ~/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env
```

Notes:

- The desktop app does not see variables exported in `~/.zshrc`; use the settings or the `.env` file there.
- The data directory survives plugin updates but is **deleted when the plugin is uninstalled**. Back up `.env` first.
- A key in the keychain takes precedence over `.env`. Passing an empty string does not clear a sensitive setting; reinstall the plugin to clear it.

## Usage

- Press **通义 改写** or **豆包 改写** under a reply to show that model's rewrite. Press it again to return to the original. Pressing the other button switches to the other model's rewrite.
- If a rewrite fails, the button stays off and the reason is shown next to it. Press again to retry.
- `/readable qwen` or `/readable doubao`: rewrite every new reply automatically with that model. Earlier replies stay as they are until you press their button.
- `/readable off`: back to the default (rewrite only on button press).
- `/readable`: show the current mode.

## Privacy

Rewriting sends the reply text to Alibaba Cloud or Volcengine. Replies may contain code, file paths and project details; decide whether that is acceptable for your work before turning it on.

## Adding a provider

Any provider with an OpenAI-compatible `/chat/completions` endpoint can be added:

1. Add a row to `MODELS` in [`hooks/register.tsx`](hooks/register.tsx): button label, color and config prefix.
2. Add `<prefix>_api_key`, `<prefix>_model`, `<prefix>_base_url` and `<prefix>_extra_body` to `userConfig` in `plugin.json`.
3. Add the provider name to `Rewriter` and `Entry` in [`types/index.d.ts`](types/index.d.ts).

## Development

```bash
claude plugin test .
claude plugin validate .
```

Tests mock HTTP requests and never call a real API.

[`hooks/actions.ts`](hooks/actions.ts) defines the shared button row under replies. zh-en-bridge ships an identical copy; keep the two in sync.

Claude Code decides whether an update exists from `version` in `plugin.json`. To release, bump the version, push, then run:

```bash
claude plugin marketplace update readable-rewrite-cn && claude plugin update readable-rewrite-cn@readable-rewrite-cn
```

## License

[MIT](LICENSE)
