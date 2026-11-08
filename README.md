# SignAll App Source

一个开源、可自行托管的全能签（SignAll）第三方软件源。元数据使用 TypeScript + JSON 校验，静态源由 Cloudflare Pages 提供，IPA 存放在 Cloudflare R2。项目不依赖数据库、用户系统或管理后台。

当前为第一阶段 MVP。协议字段已按官方源、官方 PHP 源码及社区静态源核对，并已在全能签 iOS 客户端完成订阅和软件列表显示验证，详见 [协议调查](docs/protocol.md)。

## 技术方案

- `data/source.json`：源名称、稳定标识、公告和源图标。
- `data/apps.json`：应用、版本、R2 对象键、文件大小和 SHA-256。
- `data/upstreams.json`：自动跟踪的 GitHub 仓库与应用 ID 映射。
- `src/schema.ts`：Zod Schema 和跨文件约束。
- `dist/appstore` / `dist/appstore.json`：构建出的静态源 JSON。
- `public/_worker.js`：约 70 行的 Pages 兼容层，让 `/appstore` 同时接受 GET、POST 和 HEAD。
- Cloudflare R2：保存 IPA，公开 HTTPS 直链由构建时环境变量生成。
- Cloudflare Pages Git 集成：`main` 更新后自动构建和发布。
- GitHub Actions：Pull Request 与主分支元数据、类型和单元测试校验。

JSON 本身是静态的，Worker 只处理路径、方法和响应头，不承担数据存储或动态业务。

## 协议摘要

官方源 `https://qnq.nuosike.cn/appstore` 当前实际响应：

- HTTP 200，正文是 JSON，但 `Content-Type` 为 `text/html; charset=UTF-8`。
- 顶层包含 `name`、`message`、`identifier`、`sourceURL`、`sourceicon`、`payURL`、`unlockURL`、`apps`。
- 版本号位于每个 app 中，不存在一个可作为“源协议版本”的顶层 `version` 字段。
- `type` 对应官方后台分类：`0` 默认、`1` 应用、`2` 游戏、`3` 影音、`4` 工具、`5` 插件。
- `lock` 是下载门禁；`"1"` 可在未授权或过期时隐藏下载地址。静态免费源只输出 `"0"`。
- `isLanZouCloud` 为蓝奏云解析标志。`"1"` 见于带密码的蓝奏云测试条目；本项目只输出 `"0"`。
- `size` 按字节保存；构建结果以十进制字符串输出。

官方接口支持 `GET` 和 `POST`。本项目同时提供 `/appstore` 与 `/appstore.json`，并让两种请求方法返回同一份 JSON。

## 本地开发

要求 Node.js 22+ 和 npm。

```powershell
npm install
Copy-Item .env.example .env
```

编辑 `.env`：

```dotenv
PUBLIC_BASE_URL=https://your-project.pages.dev
R2_PUBLIC_BASE_URL=https://ipa.example.com
```

然后执行：

```powershell
npm run validate
npm run typecheck
npm test
npm run build
npm run test:pages
```

本地预览：

```powershell
npm run dev
```

默认订阅地址为 `http://localhost:8788/appstore`。`npm run test:pages` 会自动选择空闲端口，并验证 GET、POST、HEAD、根路径跳转、图标和 405 行为。

## 添加或更新应用

编辑 `data/apps.json`。每款应用可以有多个历史版本，构建时每个版本会展开为一条全能签 app 记录。

```json
{
  "id": "my-app",
  "name": "My App",
  "bundleIdentifier": "com.example.myapp",
  "icon": "icons/my-app.png",
  "type": 1,
  "tintColor": "1D9BF0",
  "versions": [
    {
      "version": "1.2.0",
      "versionDate": "2026-11-06T12:00:00+08:00",
      "versionDescription": "更新说明",
      "file": {
        "key": "apps/my-app/1.2.0/my-app-1.2.0.ipa",
        "size": 12345678,
        "sha256": "64-character-lowercase-sha256"
      }
    }
  ]
}
```

约束：

- `id` 只能使用小写字母、数字和连字符，并且发布后应保持不变。
- `bundleIdentifier` 必须唯一。
- 同一应用不能重复版本号。
- R2 键必须是 `apps/<app-id>/<version>/<file>.ipa`。
- 图标必须放在 `public/icons/`。
- `size` 使用字节整数，`sha256` 用于上传前核对文件。
- 不要提交 `.ipa` 到 Git；`.gitignore` 已忽略该类型。

修改 `data/source.json` 可自定义源名称、公告、图标和稳定标识。`identifier` 一旦公开就不要修改，否则客户端可能把更新当成另一个源。

## 配置 Cloudflare R2

1. 在 Cloudflare 控制台创建 R2 bucket，例如 `signall-ipa`。
2. 为 bucket 启用公开访问。生产环境建议绑定自己的 HTTPS 域名；也可以使用 R2 提供的 `r2.dev` 公开域名。
3. 把公开域名写入 `R2_PUBLIC_BASE_URL`，不要带末尾 `/`。
4. 在本地设置 `R2_BUCKET`，使用有 R2 写权限的 Cloudflare API Token 上传文件。

示例测试 IPA 来自用户指定的 [zhihu-minus-minus v0.9.9](https://github.com/huamurui/zhihu-minus-minus/releases/tag/v0.9.9)：

```powershell
$ipa = "C:\path\to\zhihu-minus-minus-v0.9.9-unsigned.ipa"
$key = "apps/zhihu-minus-minus/0.9.9/zhihu-minus-minus-v0.9.9-unsigned.ipa"
npm run ipa:upload -- --file $ipa --key $key --bucket signall-ipa --dry-run
npm run ipa:upload -- --file $ipa --key $key --bucket signall-ipa
```

上传脚本会先核对 `data/apps.json` 中的大小和 SHA-256，再调用 Wrangler。`--dry-run` 不访问 Cloudflare。

当前示例 IPA 是未签名包，需要导入全能签后由用户自己的证书签名。示例图标和描述来自上述上游项目，许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 自动跟踪上游 Release

[sync-upstream-release.yml](.github/workflows/sync-upstream-release.yml) 每天检查一次 [data/upstreams.json](data/upstreams.json) 中所有仓库的最新正式 Release，计划时间为 `Asia/Shanghai` 约 09:17。修改跟踪配置、同步器相关代码或手动运行时也会立即检查。

当前跟踪：

- `huamurui/zhihu-minus-minus` → app id `zhihu-minus-minus`
- `jiangtian616/JHenTai` → app id `jhentai`
- `hrydgard/ppsspp` → app id `ppsspp`
- `MinusJoe/GateNest` → app id `gatenest`
- `ComicSparks/jasmine` → app id `jasmine`

处理流程：

1. 调用 GitHub Releases API 获取最新正式版，不接受 draft 或 prerelease。
2. 优先选择文件名包含 `unsigned` 的 `.ipa`，否则使用第一个 `.ipa`。
3. 根据 tag 生成版本号，例如 `v0.9.10` 转为 `0.9.10`。
4. 下载 IPA，并与 GitHub 提供的 SHA-256 digest 和文件大小交叉校验。
5. 上传到 R2 的 `apps/zhihu-minus-minus/<version>/<file>.ipa`。
6. 更新 `data/apps.json`，新版本放在历史版本前面。
7. 提交并推送到 `main`，由 Cloudflare Pages Git 集成自动发布。
8. 等待并验证线上源确实包含新版本。

版本已经存在且文件大小、SHA-256 均一致时，工作流不会下载 IPA，也不会产生提交。

上游首次出现、但 `data/apps.json` 中尚无对应应用时，`upstreams.json` 必须提供 `createApp` 基础配置。Actions 会先下载并上传 IPA，再把新应用和首个版本写入 `data/apps.json`。因此不要手工预置一个指向尚未上传 R2 文件的版本。

### GitHub 配置

在 GitHub 仓库添加 Secrets：

- `CLOUDFLARE_API_TOKEN`：Cloudflare API Token，至少包含目标账号的 `Workers R2 Storage: Edit` 权限。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare Account ID。

可选的 Repository Variables：

- `R2_BUCKET`：R2 bucket 名称，未设置时默认 `signall-ipa`。
- `PUBLIC_BASE_URL`：线上源 origin，例如 `https://signall-app-source.pages.dev`。未设置时工作流默认验证当前项目地址；仍建议显式设置，避免以后切换域名时检查错误目标。

Cloudflare Token 只保存在 GitHub Secrets，不写入仓库、构建产物或日志。若仓库或组织限制了 `GITHUB_TOKEN` 的写权限，需要在 `Settings` → `Actions` → `General` 中允许工作流写入仓库内容。

首次启用前必须完成 Cloudflare Pages Git 连接。上传 IPA 失败时，工作流会在提交元数据之前停止，不会发布指向不存在文件的版本。

如果 Cloudflare 已完成构建和资源上传，但最终提示 `Failed to publish your Function`，这属于 Pages Function 发布阶段的平台错误。可在 Pages 部署详情中点击重试；本项目已确认重试后能够成功。

## 部署到 Cloudflare Pages

推荐将现有 Pages 项目连接到 GitHub 仓库，由 Cloudflare 在 `main` 更新后自动构建。这样不需要把 Cloudflare API Token 放进 GitHub。

### Cloudflare Git 集成

在 Cloudflare Dashboard 中进入 `Workers & Pages`，选择 Pages 项目 `signall-app-source`，然后进入 `Settings` → `Builds & deployments` → `Connect to Git`。

构建配置：

| 设置 | 值 |
| --- | --- |
| Git provider | GitHub |
| Repository | `sliots/appstore` |
| Production branch | `main` |
| Framework preset | None |
| Build command | `npm run validate && npm run typecheck && npm test && npm run build` |
| Build output directory | `dist` |
| Root directory | 留空 |

构建环境变量：

| 变量 | 示例 |
| --- | --- |
| `NODE_VERSION` | `22` |
| `PUBLIC_BASE_URL` | `https://signall-app-source.pages.dev` |
| `R2_PUBLIC_BASE_URL` | `https://pub-xxxxxxxx.r2.dev` |

环境变量应同时提供给 Production 和 Preview，避免分支构建因缺少配置而失败。`PUBLIC_BASE_URL` 应始终填写正式订阅地址，保证 `sourceURL` 稳定。

第一次构建前需要完成 R2 公开访问和示例 IPA 上传。首次构建完成后检查：

1. `/appstore` 返回 JSON。
2. 源图标和应用图标可以访问。
3. IPA 下载地址返回 `200`。
4. 全能签中刷新源后版本和更新说明正确。

连接 Git 后不要再让 GitHub Actions 同时执行 Pages 部署，否则同一提交可能产生两次部署。本仓库只保留 GitHub Actions 校验工作流。

### 手动部署

本地 Wrangler 已登录时，也可以直接上传 `dist/`：

```powershell
npm run build
npx wrangler pages deploy dist --project-name signall-app-source --branch main
npm run verify:public -- "https://signall-app-source.pages.dev/appstore"
```

指定预期版本验证：

```powershell
npm run verify:public -- "https://signall-app-source.pages.dev/appstore" --expected-version 0.9.9
```

## 客户端订阅

部署并验证完成后，在全能签中加入：

```text
https://signall-app-source.pages.dev/appstore
```

也可尝试 `/appstore.json` 或站点根地址。根地址会 302 到规范路径。

## 自动校验覆盖

- JSON 结构和必需字段。
- 应用 ID、bundle identifier 和版本唯一性。
- 日期、颜色、R2 键、文件大小和 SHA-256 格式。
- R2 路径与应用 ID、版本号一致性。
- 源输出字段、类型、稳定标识和绝对 URL。
- 本地 Pages GET/POST/HEAD 响应与 Content-Type。
- 可选的生产源与 R2 资源 HEAD 检查。

## 已知限制

- 已完成真实 iOS 设备上的“添加第三方源、刷新、显示应用和进入签名流程”验证；具体证书签名与安装结果仍取决于用户自己的证书。
- `type` 的分类名来自官方后台配置，客户端展示效果未单独验证。
- `isLanZouCloud` 在本项目中固定为 `"0"`；MVP 不实现蓝奏云解析。
- `lock` 在本项目中固定为 `"0"`；MVP 不实现卡密、设备授权或动态隐藏下载地址。
- 本项目不自带签名证书，也不提供绕过 Apple 签名或应用授权的能力。

## 项目结构

```text
.
├── data/
│   ├── source.json
│   ├── apps.json
│   └── upstreams.json
├── public/
│   ├── _headers
│   ├── _worker.js
│   └── icons/
├── scripts/
│   ├── smoke-pages.ts
│   ├── sync-upstream-release.ts
│   ├── upload-ipa.ts
│   └── verify-public.ts
├── src/
│   ├── build.ts
│   ├── metadata.ts
│   ├── schema.ts
│   └── validate.ts
├── tests/
├── .github/workflows/
├── wrangler.jsonc
└── HANDOFF.MD
```

## 开发流程

推荐通过 Pull Request 修改应用元数据。PR 会运行完整校验，但不会部署。合并到 `main` 后由 Cloudflare Pages Git 集成自动构建和发布。

协议调查过程和来源记录在 [docs/protocol.md](docs/protocol.md)。后续开发前先阅读 [HANDOFF.MD](HANDOFF.MD)，避免重复踩坑。

## License

项目代码采用 MIT License。第三方示例资源和商标不因本项目许可证而改变，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
