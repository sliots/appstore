# HANDOFF

## 当前状态

- 仓库从空目录开始，第一阶段 MVP 已实现。
- 技术路径：静态 JSON + Cloudflare Pages + 一个薄 `_worker.js`，IPA 指向公开 R2。
- 示例应用使用 `huamurui/zhihu-minus-minus` v0.9.9 的未签名 IPA，示例 IPA 不提交进 Git。
- R2 bucket：`signall-ipa`；公开地址：`https://pub-7f72c59ea52748abbed2df2a02dc186d.r2.dev`。
- Pages 项目：`signall-app-source`；线上源：`https://signall-app-source.pages.dev/appstore`。
- 示例 IPA 已上传，生产 GET/POST/HEAD、图标和 IPA 直链验证通过。
- 已在 iOS 全能签中验证订阅、刷新、应用显示和进入签名流程。
- GitHub 远端当前仍无提交，Pages 项目尚未连接 Git provider。
- 本机 `.env` 已配置真实公开地址，文件被 Git 忽略。

## 已确认的协议事实

- 官方入口是 `https://qnq.nuosike.cn/appstore`。
- 官方 GET 和 POST 都可返回 JSON。
- 官方响应正文是 JSON，但 `Content-Type` 是 `text/html`。校验时不要只依赖 Content-Type。
- 顶层没有 `version`；版本号在 `apps[].version`。
- `lock` 是下载门禁。`1` 时官方源码可在未授权/过期状态清空下载地址。
- `isLanZouCloud=1` 与蓝奏云链接解析相关。MVP 固定输出 `0`。
- 官方分类：`0` 默认、`1` 应用、`2` 游戏、`3` 影音、`4` 工具、`5` 插件。
- `identifier` 应稳定；修改后客户端可能识别成另一个源。
- 官方数据存在字符串/数字混用，不要据此强行认定单一 JSON 类型。

## 实施注意

- 所有公开 URL 必须由构建时的 `PUBLIC_BASE_URL` 和 `R2_PUBLIC_BASE_URL` 生成，不要硬编码个人域名。
- `sourceURL` 指向 `<PUBLIC_BASE_URL>/appstore`。
- 构建同时写 `dist/appstore` 和 `dist/appstore.json`。
- `public/_worker.js` 必须保留 POST 兼容；官方接口已经观察到 POST。
- `lock=1`、蓝奏云解析、卡密授权均超出 MVP，静态源不要悄悄输出这些分支。
- `npm run test:pages` 会启动 Wrangler 本地 Pages，验证路径、方法、Content-Type、根跳转和图标。
- `npm run verify:public` 会验证真实源和资源 HEAD；部署后使用它，不只是看 Actions 部署成功。
- R2 未配置公开访问时，即使目录可上传，客户端也拿不到 IPA。
- 原生 Git 集成只需要 Pages 构建环境变量，不需要把 Cloudflare Token 放进 GitHub。任何 API Token、Secret 都不要写入仓库或 `.env.example`。
- 已选择 Cloudflare Pages 原生 Git 集成作为主发布方式；GitHub Actions 只负责校验，避免双重部署。

## 研究来源

- 官方源：`https://qnq.nuosike.cn/appstore`
- 官网：`https://sign.nuosike.com/signall`
- 官方 PHP 源码：官网中的 `软件源源码.zip`
- 社区 PHP：`https://github.com/XooUooX/iOS_AppStore`
- 社区静态源：`https://github.com/leiting2327/qnq-source`
- 带 Actions/R2 的静态源：`https://github.com/tomoya06/esign-tmy-sources`

## 已知坑

- Windows PowerShell 不要混用 Bash here-doc 或 Bash 变量语法。
- 从 GitHub Release 下载示例 IPA 时直连可能超时；本机代理 `http://127.0.0.1:7890` 可正常完成下载。
- 示例 IPA 已完整下载核对：`14830602` 字节，SHA-256 为 `adc704a5dbe41e80c3a11946d79cef9c16a9bfaee01834beeebe21a1672b32ae`。
- 官方 `Content-Type` 不规范，是历史实现，不应复制其错误响应头。
- GitHub raw JSON 可以直接当作静态源，但普通 GitHub 文件下载重定向会改变兼容性；本项目使用 Pages 自定义域名。
- 官方源图标和应用图标均观察到 PNG/JPEG；为减少客户端图片库差异，发布用源图标已提供 PNG，SVG 只保留作设计源。
- GitHub Release 中的示例 IPA 是未签名包，直接“安装”不能替代全能签签名。
- 上游 `zhihu-minus-minus` 图标采用 GPL-3.0；项目代码 MIT，第三方资产单独记录在 `THIRD_PARTY_NOTICES.md`。
- 首次部署前必须先上传示例 IPA，否则部署后的资源验证会失败。
- Wrangler 4.158 的 `pages project create` 会默认委派到新版 Workers 流程，并对无 `main`/`assets` 的配置报错。创建传统 Pages 项目时必须使用 `--force`；项目创建后不要再给后续 `pages deploy` 加 `--force`。
- 当前 Pages 项目最初由直接上传创建，Git Provider 为 `No`，需要在 Dashboard 中执行 `Connect to Git`。

## 下一步

- 提交并推送仓库到 `https://github.com/sliots/appstore.git`。
- 在 Cloudflare Pages 项目设置中连接 GitHub、`main` 分支与 `dist` 输出目录。
- 为 Production 和 Preview 配置 `NODE_VERSION`、`PUBLIC_BASE_URL`、`R2_PUBLIC_BASE_URL`。
- 触发首次 Git 构建并重新执行生产验证。
