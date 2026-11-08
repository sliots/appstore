# HANDOFF

## 当前状态

- 仓库从空目录开始，第一阶段 MVP 已实现。
- 技术路径：静态 JSON + Cloudflare Pages + 一个薄 `_worker.js`，IPA 指向公开 R2。
- 示例应用使用 `huamurui/zhihu-minus-minus` v0.9.9 的未签名 IPA，示例 IPA 不提交进 Git。
- R2 bucket：`signall-ipa`；公开地址：`https://pub-7f72c59ea52748abbed2df2a02dc186d.r2.dev`。
- Pages 项目：`signall-app-source`；线上源：`https://signall-app-source.pages.dev/appstore`。
- 示例 IPA 已上传，生产 GET/POST/HEAD、图标和 IPA 直链验证通过。
- 已在 iOS 全能签中验证订阅、刷新、应用显示和进入签名流程。
- GitHub `main` 已建立并推送，自动同步功能随最新提交发布。
- Pages 项目 Git Provider 已为 `Yes`，最新 `main` 提交构建成功并成为 Production。
- 本机 `.env` 已配置真实公开地址，文件被 Git 忽略。
- 已实现 `.github/workflows/sync-upstream-release.yml`，每天约 09:17（Asia/Shanghai）检查 `data/upstreams.json` 中所有仓库的最新正式 Release。
- 修改 `data/upstreams.json` 或同步工作流本身会立即触发一次同步；Actions 只修改 `data/apps.json`，因此不会循环触发。
- 同步器脚本、校验脚本、相关 Schema/测试或依赖变更也会触发同步，便于修复失败后自动补发识别到的新版本。
- 自动同步会下载未签名 IPA、核对 GitHub digest、上传 R2、更新版本历史、提交并等待 Pages 发布新版本。
- 已加入 `jiangtian616/JHenTai` 跟踪配置与图标，但按用户要求没有本地上传其 IPA；首次 Actions 运行时会创建 app 并上传 `JHenTai_8.0.18+344.ipa`。

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
- 当前 Pages 项目最初由直接上传创建，后来通过 Dashboard 连接 Git。Git Provider 现为 `Yes`，不要重复创建同名 Pages 项目。
- GitHub 自动同步上传 R2 需要 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` Secrets；若缺少，新版本任务会在上传阶段失败且不会提交元数据。
- 自动同步只更新版本、更新说明、日期、大小、SHA-256 和 R2 键。上游如果修改 bundle identifier 或图标，仍需人工更新配置。
- 多仓库同步先下载所有变更并更新内存中的 metadata，全部成功后才写 `data/apps.json`；任何一个下载校验失败都不会产生 R2 之后的元数据提交。
- Actions 的校验步骤运行在同步器已修改 `data/apps.json` 的工作区上；测试必须按应用 ID/名称定位记录，不能假设应用总数固定为 1，也不能依赖数组首位永远是知乎。
- 测试也不能把当前版本号或 R2 路径写死。知乎从 0.9.9 更新到 0.9.10 时，旧断言导致同步在 R2 上传前失败。
- 运行 `42458761774` 的失败已修复；知乎 0.9.10 随后通过 Actions 自动上传并同步，提交为 `7f82184`。
- GitHub Actions 的 cron 使用 UTC；当前 `17 1 * * *` 对应北京时间约 09:17，平台负载可能造成延迟。
- JHenTai 的 iOS bundle identifier 来自 `ios/Runner.xcodeproj/project.pbxproj`：`top.jtmonster.jhentai`。
- JHenTai 最新 IPA 为 `JHenTai_8.0.18+344.ipa`，`13027008` 字节，SHA-256 `9da792f811e7a201adc96d281b5610915c1c9e28adc47d13a9bfef46cc4cc181`。
- 已加入 `hrydgard/ppsspp` 跟踪配置与官方 iOS 图标；Actions 已创建 app 并上传 `PPSSPP-iOS-v1.20.4.ipa`。
- PPSSPP 的 bundle identifier 来自 `ios/PPSSPP-Info.plist`：`org.ppsspp.ppsspp-free`。
- PPSSPP 最新 IPA 为 `PPSSPP-iOS-v1.20.4.ipa`，`31124277` 字节，SHA-256 `822c7042311ff47710c9148c8edb5aab649cf85ce6ba96b9e8190feb91f45a51`，许可证 GPL-2.0-or-later。
- PPSSPP 同步提交为 `84a5d5e`，线上源已验证包含 0.9.9、8.0.18、1.20.4 三个版本，PPSSPP R2 直链返回 200。
- 已加入 `MinusJoe/GateNest` 跟踪配置与官方 iOS 图标，由配置变更自动触发 Actions 上传和发布。
- GateNest bundle identifier 来自 `app.json`：`com.ppx.sub2apimate`。
- GateNest 最新 IPA 为 `gatenest-v1.9.0-unsigned.ipa`，`18785383` 字节，SHA-256 `8c13588c24194fbcee2b021c18937e9d88c6a04cfb5234c0a4ea32bdc8d3ac8f`，许可证 Apache-2.0。
- GateNest 上游中文 README 声明当前维护仓库为 `trilogys/GateNest`；本项目仍按用户指定的 `MinusJoe/GateNest` 跟踪，若该镜像停止发布需要人工切换。
- GateNest 同步提交为 `546d14c`，线上源已验证包含 0.9.9、8.0.18、1.20.4、1.9.0 四个版本，GateNest R2 直链返回 200。
- 已加入 `ComicSparks/jasmine` 跟踪配置与官方 iOS 图标，由配置变更自动触发 Actions。
- Jasmine bundle identifier 来自 `ios/Runner.xcodeproj/project.pbxproj`：`opensource.jasmine`。
- Jasmine 最新 IPA 为 `jasmine-v1.7.22-nosign.ipa`，`16242547` 字节，SHA-256 `55e619619a12c4e8c9d6769534575fec1636af7c5b5fd7e0260249155124debb`，许可证 MIT。
- Jasmine 同步提交为 `f034f8b`，线上源已验证包含 0.9.9、8.0.18、1.20.4、1.9.0、1.7.22 五个版本，Jasmine R2 直链返回 200。
- 首次 JHenTai 同步时，Cloudflare 构建和静态资源上传成功，但 Function 发布返回 `Unknown internal error occurred`；通过 Pages API 重试同一提交后成功。
- GitHub Actions 的“部署后验证”曾因未配置 `PUBLIC_BASE_URL` Variable 而被跳过，掩盖了 Pages 构建失败；现在 workflow 默认回退到 `https://signall-app-source.pages.dev` 并始终执行版本验证。
- `/appstore` 响应已改为 `Cache-Control: no-store`，避免更新后手机端继续缓存旧 JSON。若客户端自身仍缓存，手动下拉刷新或重启客户端即可。
- 线上源当前验证包含知乎 0.9.10、JHenTai 8.0.18、PPSSPP 1.20.4、GateNest 1.9.0、Jasmine 1.7.22，共 6 条版本记录。

## 下一步

- 创建仅含 R2 写权限的 Cloudflare API Token，并写入 GitHub Secrets。
- 建议添加 `PUBLIC_BASE_URL` 和 `R2_BUCKET` Repository Variables；即使缺少 `PUBLIC_BASE_URL`，工作流现在也会验证默认 Pages 地址。
- 手动运行 `Sync upstream release`，确认当前 `v0.9.9` 返回无更新。
