# readable-rewrite-cn

[English](README.md) | 简体中文

一个 Claude Code 插件：用你自己的通义（阿里云百炼 / DashScope）或豆包（火山方舟）API，把 Claude 的回复改写成更好懂的中文。改写只在界面上显示，对话记录里存的还是原文，Claude 的上下文不受影响。

## 缘起

Claude Code 用中文回答时，回复常常很密：长句多、术语堆叠、带翻译腔，读起来费劲。把这类文字换个说法讲清楚，小而便宜的中文模型就能做好。放在显示层做有几个好处：

- 不改 Claude 的上下文，改写不会影响后面的对话；
- 不消耗 Claude 的 token；
- 什么时候改写由你决定，随时可以切回原文。

## 功能

- 每条 assistant 回复下面有两个开关按钮：**通义 改写**、**豆包 改写**。点亮显示该模型的改写版，再点一下回到原文。
- 改写结果按原文 hash 分模型缓存，来回切换不会重复请求。
- 可选自动模式：`/readable qwen` 或 `/readable doubao` 之后每条新回复自动改写。
- 少于 60 个字的回复和子代理的输出不处理。
- 任何 OpenAI 兼容的 `/chat/completions` 接口都可以加成新的服务商。
- 和 [zh-en-bridge](https://github.com/REXKEV214/zh-en-bridge) 一起装时，两个插件的按钮排在回复下面同一行。

## 环境要求

- 支持插件的 Claude Code（终端版或桌面 app）。
- 至少一家的 API Key 和模型 ID：[阿里云百炼](https://bailian.console.aliyun.com/) 或 [火山方舟](https://console.volcengine.com/ark)。

## 安装

```bash
claude plugin install readable-rewrite-cn --marketplace REXKEV214/readable-rewrite-cn --scope user
```

按下文配好 Key 和模型 ID，新开会话即可使用。

## 配置

配置项是 [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) 里的 `userConfig`：

| 字段 | 说明 | 默认值 |
|---|---|---|
| `qwen_api_key` | 通义 API Key，存进系统钥匙串 | 空 |
| `qwen_model` | 通义模型 ID，从百炼控制台复制 | 空 |
| `qwen_base_url` | 通义 OpenAI 兼容地址 | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `qwen_extra_body` | 合并进请求体的 JSON | `{"enable_thinking": false}` |
| `ark_api_key` | 火山方舟 API Key，存进系统钥匙串 | 空 |
| `ark_model` | 豆包模型 ID 或接入点 `ep-xxx` | 空 |
| `ark_base_url` | 火山方舟 OpenAI 兼容地址 | `https://ark.cn-beijing.volces.com/api/v3` |
| `ark_extra_body` | 合并进请求体的 JSON | `{"thinking": {"type": "disabled"}}` |
| `system_prompt` | 发给改写模型的 system prompt | 见 `plugin.json` |
| `user_template` | user prompt 模板，`{{text}}` 换成回复原文 | 见 `plugin.json` |
| `timeout_seconds` | 单次请求超时（秒） | `120` |

Key 和模型 ID 没填时，点按钮只提示「未配置」，不发请求。`*_extra_body` 的默认值用来关闭思考模式，模型不认这个参数、报错时清空即可。

用命令行填写（Key 不会留在 shell 历史里；没写的项保持原值）：

```bash
claude plugin configure readable-rewrite-cn@readable-rewrite-cn --values-stdin <<'EOF'
{"qwen_api_key": "sk-...", "qwen_model": "通义模型 ID", "ark_api_key": "...", "ark_model": "ep-..."}
EOF
```

非敏感字段（模型 ID、地址、prompt）也可以在 Claude Code 的 `/config` 菜单里改。

### API Key 的读取顺序

1. `qwen_api_key` / `ark_api_key` 配置项（系统钥匙串）；
2. `~/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env` 里的 `DASHSCOPE_API_KEY` / `ARK_API_KEY`；
3. 同名环境变量。

用 `.env` 文件：

```bash
mkdir -p ~/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn
cp .env.example ~/.claude/plugins/data/readable-rewrite-cn-readable-rewrite-cn/.env
```

注意：

- 桌面 app 读不到 `~/.zshrc` 里 export 的变量，桌面 app 请用配置项或 `.env`。
- 数据目录在插件更新时保留，**卸载插件时会被删掉**，卸载前先备份 `.env`。
- 钥匙串里的 Key 优先于 `.env`。敏感配置项传空字符串清不掉，要清空只能卸载重装。

## 使用

- 点回复下面的 **通义 改写** 或 **豆包 改写**，显示该模型的改写版；再点一下回到原文；点另一个按钮换成另一个模型的改写版。
- 改写失败时按钮不亮，旁边显示原因，再点一次重试。
- `/readable qwen` 或 `/readable doubao`：之后每条新回复都自动用该模型改写。
- `/readable off`：恢复默认，只有点按钮才改写。
- `/readable`：查看当前模式。

## 隐私

改写会把回复原文发给阿里云或火山引擎。回复里可能有代码、路径和项目细节，开启前请自行判断能不能发。

## 加一个新的服务商

只要对方提供 OpenAI 兼容的 `/chat/completions` 接口就可以加：

1. 在 [`hooks/register.tsx`](hooks/register.tsx) 的 `MODELS` 表里加一行：按钮名、颜色、配置前缀。
2. 在 `plugin.json` 的 `userConfig` 里加 `<前缀>_api_key`、`<前缀>_model`、`<前缀>_base_url`、`<前缀>_extra_body` 四个字段。
3. 在 [`types/index.d.ts`](types/index.d.ts) 的 `Rewriter` 和 `Entry` 里加上它的名字。

## 开发

```bash
claude plugin test .
claude plugin validate .
```

测试会 mock 掉 HTTP 请求，不会真的调用 API。

[`hooks/actions.ts`](hooks/actions.ts) 定义了回复下面共用的按钮行，zh-en-bridge 里有一份相同的文件，改了要两边同步。

Claude Code 按 `plugin.json` 里的 `version` 判断有没有新版本。发布时先改版本号并推送，再运行：

```bash
claude plugin marketplace update readable-rewrite-cn && claude plugin update readable-rewrite-cn@readable-rewrite-cn
```

## 许可证

[MIT](LICENSE)
