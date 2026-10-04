# Proxy Timezone Sync

在指定 AI 网站中，按该网站实际使用的代理出口同步时区。支持 Windows 和 macOS，不同网站可以同时使用不同的时区。

[安装 / 更新油猴脚本](https://raw.githubusercontent.com/AlexbeatsZ/proxy-timezone-sync/main/proxy-timezone-sync.user.js)

## 3.0 的识别方式

脚本先由当前网页请求本站的 `/cdn-cgi/trace`。网站返回出口 IP 后，再查询这个明确 IP 的时区。查询 IP 服务本身走哪个代理，不会被当成当前网站的出口。

网站没有有效 trace 时，可以连接本机代理助手。助手只读 Clash Verge / Mihomo 当前连接，找到这个网站实际使用的节点，再通过已有普通代理端口或 clean-pool 端口探测出口。只有探测链与网站连接链一致才采用结果，不会切换节点或修改规则。

- 自动结果、手动时区按完整网站域名隔离。
- 旧版全局缓存和手动值仍保留，但不会自动套用。需要时从菜单选择「沿用旧手动时区到此网站」。
- 当前网站有多条不同代理链、没有可核实的连接或探测失败时，使用系统时区。
- 可见页面每分钟检查一次；切回标签页和菜单手动刷新也会重新检查。
- 路由缓存最长 15 分钟，命中缓存仍核对当前网站和新探测连接的实际链。

## 安装和迁移

1. 打开上方链接，将原有脚本更新到 `3.0.0`。保留原来的脚本，避免同时启用两份。
2. 更新后刷新已经打开的 QQ 和 AI 网页。旧脚本修改过的时间接口需要重新载入页面才会恢复。
3. 若需要识别没有 trace 的网站，按下文启动本机助手，在油猴菜单中选择「连接本机代理助手（Windows / Mac）」，粘贴 `.runtime/client-settings.json` 的完整内容。
4. 通过「查看此网站时区」查看当前时区、识别来源、出口 IP 和代理链。

脚本名称和 namespace 保持不变。脚本覆盖 `Date` 本地时间 getter 与 `Intl.DateTimeFormat` 默认时区；页面明确传入的 `timeZone` 保持其指定值。识别为异步操作，识别完成前使用系统时区，页面已经渲染的文字是否更新取决于页面本身。

## 本机代理助手

需要现有 Node.js 20 或更新版本，以及运行中的 Clash Verge / Mihomo。无需安装 npm 包，也无需开放控制器 TCP 端口。助手监听 `127.0.0.1:17898`，用随机令牌验证访问，仅提供 AI 网站的只读识别接口。

### Windows

在项目目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-bridge.ps1
Get-Content .runtime\client-settings.json
```

默认目录：`C:\Users\Meta\Project\Scripts\JavaScript\proxy-timezone-sync`。

### macOS

在项目目录执行：

```sh
sh scripts/start-bridge.sh
cat .runtime/client-settings.json
```

默认目录：`/Users/meta/Project/Scripts/JavaScript/proxy-timezone-sync`。

助手默认使用已有的 `7897` 普通代理和 `17897` clean-pool 监听端口。如果端口不同，可修改本机 `.runtime/bridge-config.json` 的 `probePorts` 后重启助手。端口名称不会被直接当作地区依据，仍会核对实际代理链。

令牌和本机配置保存在 Git 忽略的 `.runtime/` 目录中，勿上传或公开。如果浏览器同步了油猴配置，两台设备的助手可使用同一个令牌：在第二台设备首次初始化时执行 `node bridge/server.mjs --init --client-settings <第一台设备的配置文件>`。每台助手仍有独立机器标识和缓存。

启动脚本只启动当前会话的助手，不注册登录自启。退出或重启电脑后需要重新运行。日志为 `.runtime/bridge.stdout.log` 和 `.runtime/bridge.stderr.log`。更新助手源代码使用 `git pull --ff-only`，再结束记录在 `.runtime/bridge.pid` 中的对应助手进程并重新运行启动脚本。

## 自动更新

油猴脚本已经配置固定的 GitHub `@updateURL` 和 `@downloadURL`。首次更新到本仓库版本后，Tampermonkey 按自己的更新设置检查更高的 `@version` 并下载新版。需要立即更新时，可手动检查更新。raw 地址可能短暂缓存。

本机助手源码由 Git 管理，油猴更新不会替换助手文件。

参考：[Tampermonkey 官方文档](https://www.tampermonkey.net/documentation.php?locale=zh_&q=update_url)。

## 生效范围

只有 HTTPS 页面会生效。下面域名及其子域名同时受 `@match` 与运行时检查限制：

| 服务 | 域名 |
| --- | --- |
| ChatGPT / OpenAI | `chatgpt.com`, `openai.com` |
| Claude / Anthropic | `claude.ai`, `claude.com`, `anthropic.com` |
| Grok / xAI | `grok.com`, `x.ai` |
| Gemini / Google AI | `gemini.google.com`, `aistudio.google.com`, `makersuite.google.com`, `ai.google.dev`, `ai.google`, `deepmind.google` |
| NotebookLM | `notebooklm.google.com`, `notebooklm.google`, `notebook.google` |
| DeepSeek | `deepseek.com` |
| Perplexity | `perplexity.ai` |
| Qwen | `qwen.ai` |
| Kimi / Moonshot | `kimi.com`, `kimi.ai`, `moonshot.cn`, `moonshot.ai` |
| Copilot | `copilot.microsoft.com`, `copilot.com` |
| Poe | `poe.com` |

QQ、本地服务、内网 IP、Google 搜索、Gmail、YouTube 及未列出的网站保持系统时区。不会匹配整个 `google.com`、`microsoft.com` 或 `x.com`。

## 维护与验证

```sh
node --check proxy-timezone-sync.user.js
node --test tests/*.test.mjs
```

发布脚本时提高 `@version`，提交并推送 `main`。修改 AI 范围时同时修改 `@match` 与 `AI_HOSTS`；助手直接读取脚本中的域名表。修改路由逻辑前阅读 [设计文档](docs/design/site-routing.md)。

测试覆盖不同网站和出口、路由切换、缓存隔离、歧义连接、延迟结果、旧全局值、显式 IP 查询、本机接口边界和普通网站退出。

节点链一致可以核实所用代理，但无法保证代理运营商不会按目标地址分配不同的公网出口。网站自身返回的 IP 证据优先于代理链探测。

## 来源

基于用户提供的「自动同步代理时区 (Proxy Timezone Sync) v2.1 (静默版)」，原署名 Antigravity。本仓库保留脚本身份，增加 AI 范围限制、GitHub 自动更新和按网站实际出口识别。
