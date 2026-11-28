# Source · HYWmusic 桌面播放器源码快照

> **版本：v2.0.0-beta2** ｜ 更新日期：2026-11-28
>
> 与 `../v2.0.0-beta2/HYWmusic-Portable-2.0.0-beta2.exe` **一一对应**（同一份源码构建）。

---

## 这是什么

`D:\AI File\hyw\hyw-desktop` 的**纯源码快照**，不含构建产物与依赖目录：

- ❌ 不含 `node_modules/`（约 369 MB，`npm install` 可还原）
- ❌ 不含 `release/` / `dist/` / `shots/`（构建产物与测试截图）
- ✅ 包含全部可编辑源码、图标资源、依赖锁定文件、许可证与文档

总大小约 **643 KB**，26 个文件。

## 维护约定

- **每次发版后同步本目录**，保持与 `hyw-desktop` 一致（源码唯一来源仍是 `hyw-desktop`）。
- 同步内容：`main.js`、`preload.js`、`package.json`、`package-lock.json`、
  `verify-credit.js`、`LICENSE`、`README.md`、`.npmrc`、`build/`、`engine/`、`src/`。
- 不要复制 `node_modules/`、`release/`、`dist/`、`shots/`、`_backup/`。

## 目录结构

```
Source/
├── main.js              主进程：窗口 / 托盘 / HTTP 代理 / 双引擎搜索 / 下载 / IPC
├── preload.js           contextBridge 桥接层（window.hyw）
├── package.json         依赖与打包配置（version 2.0.0-beta2）
├── package-lock.json    依赖锁定
├── .npmrc               国内镜像配置
├── LICENSE              Apache License 2.0
├── README.md            项目文档
├── verify-credit.js     交付前署名 / 版权自检脚本
├── build/
│   └── icon.ico         应用图标
├── engine/
│   └── local.js         BR 自研引擎
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
    │   ├── boot-theme.js 启动动画配色（必须先于 app.js）
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
| 打包 | `electron-builder --win portable`（只出单文件便携版） |

## 从这份源码重新构建

环境要求：Node.js 18+（推荐 22）、Windows（打包目标 win32-x64）。

```bash
cd Source
npm install
npm run dist
```

产物输出到 `package.json` 的 `build.directories.output`。

## 自检

```bash
node verify-credit.js <app.asar>
```

检查署名 `Create BY BennerRock`、LICENSE 版权、package.json author、旧署名残留。

## 本版要点（v2.0.0-beta2）

- 引擎收敛为「双引擎」：lx + api 并发同时搜索，结果合并去重，删除「自动」
- 修复搜索框 ✕ 清空无效、切音源旧结果滞留
- 补回播放栏「播放队列」按钮
- 版本号改读 `package.json`（`APP_VERSION`），避免 dev 下显示 Electron 版本
- 单音源空结果 18.6s → 1.5s，空态文案带音源名
