# 全能签软件源协议调查

调查日期：2026-11-06（Asia/Shanghai）

本文区分三类证据：

1. **官方实际响应**：直接请求官方源并观察字段和值。
2. **官方源码**：全能签官网提供的软件源源码。
3. **社区实现**：公开软源和工具，用于交叉验证，但不等同于官方规范。

## 官方响应

请求：

```http
GET https://qnq.nuosike.cn/appstore
User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)
```

观察结果：

- HTTP 200。
- `Content-Type: text/html; charset=UTF-8`。
- 响应正文是未加密 JSON，不是 HTML。
- `GET` 和 `POST` 均能返回 JSON。
- 查询参数 `udid` 会被官方接口读取；免费公开源不传该参数仍会返回列表。

代表性命中字段：

```json
{
  "name": "全能签官方源",
  "message": "...",
  "identifier": "一键签万物，万物皆可签！",
  "sourceURL": "https://qnq.nuosike.cn/appstore",
  "sourceicon": "http://qnq.nuosike.cn/uploads/...png",
  "payURL": "https://udid.nuosike.cn/sign/pay.php",
  "unlockURL": "https://qnq.nuosike.cn/appstore",
  "apps": [
    {
      "name": "全能签",
      "type": "4",
      "version": "27.1.2",
      "versionDate": "2026-11-04T15:46:53+08:00",
      "versionDescription": "...",
      "lock": "0",
      "downloadURL": "https://...ipa",
      "isLanZouCloud": "0",
      "iconURL": "https://...png",
      "tintColor": "018084",
      "size": "9384755.2"
    }
  ]
}
```

注意：官方实际数据中 `type`、`lock`、`isLanZouCloud`、`size` 存在字符串/数字混用。客户端显然接受这种混合形态；本项目选择稳定输出：

- `type`：`0` 为数字，`1` 到 `5` 为字符串。
- `lock`、`isLanZouCloud`：字符串。
- `size`：十进制字节字符串。

## 官方源码

官网“开发者软件源部署”区域提供源码包：

```text
https://ipawj.nuosike.cn/软件源源码.zip
```

源码包中的关键位置：

- `application/route.php`：把 `/appstore` 路由到 `index/App/list`。
- `application/index/controller/App.php`：组装顶层 JSON 与应用数组。
- `application/extra/site.php`：定义分类类型。
- `application/admin/view/category/*.html`：定义后台字段到协议字段的映射。

源码显示：

- 顶层没有 `version`；`version` 属于 app。
- `sourceURL` 是源入口，官方示例指向 `.../appstore`。
- `identifier` 是源标识，官方说明为“随便填写，也可填写源地址”，但应保持稳定。
- `lock` 为 `1` 时，在未授权、过期等状态下清空 `downloadURL`。
- 分类配置为 `default`、`1 => 应用`、`2 => 游戏`、`3 => 影音`、`4 => 工具`、`5 => 插件`。

因此本文把 `lock` 解释为下载门禁，而不是 iOS 文件锁；把 `type` 解释为分类编号。这是基于官方源码的强证据，但客户端 UI 的最终展示仍未单独实机核对。

## 蓝奏云标志

官方源包含以下对应关系：

- 普通 IPA：`isLanZouCloud: "0"`。
- 蓝奏云测试条目：URL 为 `https://nuosike.lanzn.com/...&pwd=8888`，`isLanZouCloud: "1"`。
- 官方源码将该字段从后台 `flag` 字段输出。

可以确认 `"1"` 与蓝奏云解析场景相关。客户端内部解析实现和失败反馈未验证，因此本项目不实现该分支，只输出 `"0"`。

## 静态 JSON 订阅

官方源码本身通过 `/appstore` 动态生成 JSON，但这不表示客户端只能订阅固定 API 路径。公开社区项目提供了以下实际用法：

- [leiting2327/qnq-source](https://github.com/leiting2327/qnq-source)：GitHub Pages 托管 `appstore.json`，README 声明可直接加入全能签。
- [tomoya06/esign-tmy-sources](https://github.com/tomoya06/esign-tmy-sources)：GitHub 上公开 `app.json`，使用 `downloadURL`、`iconURL` 等字段，并由 Actions 静态生成。
- [XooUooX/iOS_AppStore](https://github.com/XooUooX/iOS_AppStore)：PHP 社区实现，明确以 `/appstore` 为标准入口，字段形态与官方源码一致。

结论：

- 以完整 HTTPS 地址订阅静态 JSON 有多个社区成功用法，是合理的 MVP 架构。
- 本项目仍固定发布 `/appstore`，同时提供 `/appstore.json`，避免专有路径差异。
- 本项目额外使用 Pages Worker 兼容 GET/POST/HEAD，因为官方接口已观察到 GET 和 POST 均有效。
- **未在本机完成 iOS 客户端订阅测试**，所以不能把“所有全能签版本都已验证支持静态源”写成结论。

## 本项目采用的兼容输出

只输出官方源中已观察到的顶层和 app 字段，不添加仅供内部维护的 `bundleIdentifier`、`developerName` 或 AltStore 字段。

```json
{
  "name": "SignAll App Source",
  "message": "...",
  "identifier": "io.github.sliots.appstore.source",
  "sourceURL": "https://domain/appstore",
  "sourceicon": "https://domain/icons/source.png",
  "payURL": "",
  "unlockURL": "https://domain/appstore",
  "apps": [
    {
      "name": "知乎--",
      "type": "1",
      "version": "0.9.9",
      "versionDate": "2026-11-05T20:55:17+08:00",
      "versionDescription": "...",
      "lock": "0",
      "downloadURL": "https://ipa.example.com/apps/...ipa",
      "isLanZouCloud": "0",
      "iconURL": "https://domain/icons/zhihu-minus-minus.png",
      "tintColor": "1D9BF0",
      "size": "14830602"
    }
  ]
}
```

## 待实机验证

- 在产品支持的全能签版本中添加 `/appstore` 静态源。
- 检查刷新后是否显示名称、公告、源图标和应用图标。
- 检查历史版本在同一应用名称下如何展示和排序。
- 检查 `versionDate` 带 `Z` 与 `+08:00` 时是否都能正常显示。
- 检查 GET 与 POST 两种客户端请求路径。
- 下载示例 IPA 并完成本地证书签名安装。
- 若后续实现 `lock=1`，验证 `unlockURL` 的跳转和授权流程。

实机验证完成前，以上项目应继续标记为“待验证”，而不是“官方保证”。
