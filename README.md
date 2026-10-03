# Proxy Timezone Sync

仅在指定 AI 服务及相关网站同步代理出口时区的油猴脚本。

[安装 / 更新脚本](https://raw.githubusercontent.com/AlexbeatsZ/proxy-timezone-sync/main/proxy-timezone-sync.user.js)

## 安装和迁移

1. 浏览器安装 Tampermonkey 后，打开上面的安装链接。
2. 如果已经安装旧版，请更新原来的脚本。也可以在原脚本编辑页完整替换为本仓库的 `proxy-timezone-sync.user.js` 内容并保存，避免同时启用两份脚本。
3. 更新后刷新已经打开的 QQ 或其他普通网页，让旧脚本修改过的时间接口恢复为原生接口。
4. 确认 Tampermonkey 中该脚本的更新检查已开启，更新地址和下载地址均指向本仓库的 raw 文件。

原脚本名称、namespace 和两个缓存键保持不变。通过更新原脚本迁移可保留原来的手动时区和缓存配置。

## 自动更新

脚本头部已经配置：

```text
@updateURL   https://raw.githubusercontent.com/AlexbeatsZ/proxy-timezone-sync/main/proxy-timezone-sync.user.js
@downloadURL https://raw.githubusercontent.com/AlexbeatsZ/proxy-timezone-sync/main/proxy-timezone-sync.user.js
```

Tampermonkey 根据自己的更新检查设置读取远端 `@version`。发现更高版本后，按其更新设置从下载地址获取新版。需要立即更新时，可以在油猴中手动执行检查更新。

发布者修改脚本后，需要提高 `@version`，提交并推送到 `main`。无需生成文件、打包或部署网站。raw 地址可能有短暂缓存，推送不表示所有客户端立即更新。

参考：[Tampermonkey 官方元数据文档](https://www.tampermonkey.net/documentation.php?locale=zh_&q=update_url)。

## 生效范围

只有 HTTPS 页面会生效。下面列出的域名及其子域名同时受 `@match` 和运行时域名检查限制：

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

不会匹配整个 `google.com`、`microsoft.com` 或 `x.com`。QQ、本地服务、内网 IP、Google 搜索、Gmail、YouTube 和其他不在名单中的网站保持系统时区。即使脚本管理器额外配置了全站匹配，运行时检查仍会在任何 Hook、GM API 或网络操作之前退出。

## 保留的功能

- 自动检测代理出口 IP 所在时区，缓存 15 分钟。
- 菜单中立即重新检测、手动指定时区和查看诊断信息。
- AI 页面中的 `Date` 本地时间 getter 和 `Intl.DateTimeFormat` 默认时区覆盖。
- 保持原来的 `PROXY_TZ_CACHE_V2` 与 `MANUAL_TZ_OVERRIDE` 存储键。

代理探测继续使用原脚本的 `https://ipwho.is/` 和备用 `https://api.ip.sb/geoip`，`@connect` 仅允许这两个主机。

## 维护

```sh
node --check proxy-timezone-sync.user.js
git add proxy-timezone-sync.user.js README.md
git commit -m "Update userscript"
git push origin main
```

改变生效范围时，必须同时修改头部 `@match` 和 `AI_HOSTS`，并确认普通网站及相似恶意域名仍在任何时区修改前退出。

## 来源

基于用户提供的「自动同步代理时区 (Proxy Timezone Sync) v2.1 (静默版)」，原脚本署名为 Antigravity。本仓库保留原署名和脚本身份，并增加 AI 域名范围限制及 GitHub 自动更新配置。