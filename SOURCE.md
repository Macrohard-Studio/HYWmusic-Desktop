# Source · HYWmusic 桌面播放器源码快照

> **版本：v1.0.0-beta2** ｜ 归档日期：2026-11-13
>
> 与 `../v1.0.0-beta2/` 中的三个可执行文件**一一对应**（同一份源码构建）。

---

## 这是什么

`hyw-desktop/` 的完整**纯源码快照**，不含任何构建产物和依赖目录：

- ❌ 不含 `node_modules/`（369M，`npm install` 可还原）
- ❌ 不含 `release/` / `dist/` / `shots/`（构建产物与测试截图）
- ✅ 包含全部可编辑源码、图标资源、依赖锁定文件、许可证与文档

总大小约 **574K**，23 个文件。

## 目录结构

```
Source/
├── main.js              主进程：窗口 / 托盘 / 自愈 / HTTP 代理 / 认证 / 音乐接口
├── preload.js           contextBridge 桥接层（window.hyw）
├── package.json         依赖与打包配置（version 1.0.0-beta2）
├── package-lock.json    依赖锁定
├── .npmrc               国内镜像配置
├── LICENSE              Apache License 2.0
├── README.md            项目文档
├── verify-credit.js     交付前署名 / 版权自检脚本
├── build/
│   └── icon.ico         应用图标
└── src/
    ├── index.html
    ├── css/
    │   ├── theme.css    设计令牌 / 启动动画 / 提示条
    │   └── player.css   布局与组件
    ├── js/
    │   ├── icons.js     内联 SVG 图标集
    │   ├── themes.js    JSON 主题 + HSL 令牌派生（12 套）
    │   ├── api.js       接口封装 / 音源 / 音质 / 降级链
    │   ├── lyrics.js    LRC 解析与翻译合并
    │   ├── player.js    播放内核（队列 / 取链 / 播放模式 / 失效恢复）
    │   └── app.js       界面与交互
    └── assets/          favicon + logo-32/64/128 + logo.svg
```

## 技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 33 |
| 渲染层 | 原生 HTML / CSS / JavaScript，**无框架、无构建步骤** |
| 音频 | HTML5 `<audio>` |
| 网络 | 全部请求经主进程 `net.request` 代理，渲染层 CSP 为 `default-src 'none'` |
| 打包 | `@electron/packager`（文件夹便携版）、`electron-builder`（NSIS / 单文件便携版） |

## 从这份源码重新构建

环境要求：Node.js 18+（推荐 22）、Windows（打包目标 win32-x64）。

```bash
cd Source
npm install          # 还原依赖，约 369M
npm start            # 本地运行
node verify-credit.js <app.asar>   # 交付前署名自检
```

打包（输出已配置到 `version/` 的对应版本目录）：

```bash
npm run pack         # -> ../v1.0.0-beta2/portable/
npm run dist         # -> ../v1.0.0-beta2/  (安装包 + 单文件便携版)
```

国内网络需设置镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

> Windows 上若存在 `ELECTRON_RUN_AS_NODE=1`，需先清除：`env -u ELECTRON_RUN_AS_NODE npm start`

## 升级到新版本时要改的地方

1. `package.json` 的 `version` 与 `build.directories.output`
2. `package-lock.json` 的 `version`
3. `src/js/app.js` 里 `S.version` 的兜底值
4. `README.md` 的版本与日期
5. `../README.md` 的版本清单
6. `../../../_spec/界面观察笔记与验证报告.md` 的日期与交付路径

## beta2 相对 beta1 的源码变更

- `main.js`：新增认证层（卡密验证 / 管理员登录 / 会话管理）；`httpRequest` 对同源 API 自动补 `Referer`/`Origin`、自动带 `x-card-key`；401/403 文案中性化
- `preload.js` / `api.js`：新增 6 个认证 IPC 桥接方法
- `app.js`：设置新增「卡密登录」「管理员登录」「权限说明」三类；服务器下拉去掉图标
- `player.js`：新增音频链接失效自动重取链 / 兜底跳下一首（`recoverTries`）
- `icons.js`：新增 `key` / `shield` / `user` / `lock` 图标
- `player.css`：新增登录状态卡、权限表、文本输入框样式

---

Copyright 2026 BennerRock · Licensed under the Apache License, Version 2.0
