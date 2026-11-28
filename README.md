# HYWmusic

![version](https://img.shields.io/badge/version-2.0.0--beta2-blue)
![platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)
![electron](https://img.shields.io/badge/Electron-33-47848F)
![license](https://img.shields.io/badge/license-Apache--2.0-green)

HYWmusic（何意味音乐）—— 一款 Windows 桌面音乐播放器，多音源聚合搜索，开箱即用，无需注册登录。

**v2.0.0-beta2**（2026-11-28）· [Apache License 2.0](./LICENSE) · 单文件便携版，双击即用

界面参考 LX Music 的布局：左侧导航 + 顶部搜索 + 歌曲列表 + 底部播放控制栏 + 歌词面板。
音源默认走何意味音乐开放接口；也可以切到「本地（Beta）」使用内置的 **BR 自研引擎**，直接在本机请求音源、不经过服务器。

---

## 功能

### 搜索与播放

| 能力 | 说明 |
|---|---|
| 多平台搜索 | 网易云 / QQ音乐 / 酷狗 / 酷我 / 咪咕 / 汽水，可「全部」聚合 |
| 音源随线路 | **HYWmusic 线路**用服务端下发的音源列表；**本地（Beta）**用引擎实际支持的列表 |
| 双引擎 | **默认**：LX 与聚合并发同时搜索，结果合并去重；**BR 自研**（内置引擎，仅本地模式可用） |
| 两阶段加载 | 先并发打两个快平台，**约 2 秒出首批 10-20 条**，后台再补全到完整结果 |
| 音质选择 | 母带 / Hi-Res / 无损 / 高品 / 标准 五档，播放中切换会重新取链 |
| 取链优先最高档 | 播放时从母带往下逐级降，拿到什么用什么 |
| 真实播放 | HTML5 Audio 内核，支持拖动进度、音量调节、缓冲进度显示 |
| 自动换源 | 当前平台取链失败或音质受限时，自动在其他平台搜索同名歌曲重试 |
| 排序 | 原唱优先 + 按实际可用音质分级；同名同歌手去重，只展示最优的一条 |
| 可播性检测 | 搜索后后台探测各音源能否取链，确认播不了的移到列表末尾 |
| 歌词 | 标准 LRC 解析，支持**翻译**合并、逐行高亮、点击跳转播放位置 |

### 播放控制

- 上一首 / 播放暂停 / 下一首
- **四种播放模式**：列表循环 · 单曲循环 · 顺序播放 · 随机播放
- 进度条拖动定位、音量条调节、一键静音
- 快捷键：`空格` 播放暂停 · `Ctrl + ←/→` 上一首/下一首

### 音乐库（本地保存）

- **试听列表**：自动记录最近播放（最多 200 首）
- **我的收藏**：一键收藏/取消
- **播放队列**：查看当前队列、单曲移除、清空、设为下一首播放
- **我的歌单**：新建 / 重命名 / 删除，从歌曲菜单加入
- **下载**：按当前音质下载音频到本地

### 桌面特性

- 深色 / 浅色主题，标题栏颜色同步（含原生窗口按钮区）
- **线路自动选优**：并发测速，自动用响应最快的那条
- **系统托盘**：关闭时可选最小化到托盘或直接退出，支持「不再提醒」
- **退出即清干净**：选「直接退出」会销毁托盘、关闭全部窗口，并兜底强制结束，不留残留进程
- **后台降耗**：隐藏到托盘时暂停动画与轮询
- 单实例运行，重复双击唤出已有窗口
- **安全模式自愈**：检测到 GPU / 沙箱导致启动失败时自动以安全模式重启

---

## 线路与引擎

| 线路 | 引擎 | 音源列表 | 数据通道 |
|---|---|---|---|
| **HYWmusic（自动）** | 双引擎（LX + 聚合） | 服务端下发 | 何意味音乐开放接口 |
| **本地（Beta）** | BR 自研（唯一） | 引擎实际支持的平台 | 本机直连各平台 |

**线路自动选优**：启动时并发测两条线路的响应时间，自动用最快的那条，不需要手动挑。

### BR 自研引擎的边界

`engine/local.js` 是内置在客户端里的纯 Node 模块，随 `app.asar` 一起打包，不依赖任何外部服务。

| 平台 | 搜索 | 封面 | 取链（匿名） |
|---|---|---|---|
| 网易云 | ✓ | ✓ | ✓ 标准音质 |
| QQ 音乐 | ✓ | ✓ | 需登录态 → 自动回落服务端 |
| 酷狗 | ✓ | ✓ | 需 Cookie → 自动回落服务端 |
| 酷我 | ✓ | 部分 | 需签名 → 自动回落服务端 |

- **关于母带 / Hi-Res**：各平台的母带与 Hi-Res 都要登录态（VIP）才下发地址，匿名请求拿不到。引擎已预留 `cookies` 参数位，填入对应平台 Cookie 后可走高音质接口。
- **取链回落**：自研引擎拿不到地址时会自动改用服务端接口，避免出现「点了播不了」。

---

## 技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 33 |
| 主进程 | Node.js（`main.js`）— 窗口、托盘、HTTP 代理、文件下载 |
| 渲染层 | 原生 HTML / CSS / JavaScript，无框架、无构建步骤 |
| 音频 | HTML5 `<audio>` |
| 打包 | `electron-builder`（单文件便携版，`npm run dist`） |
| 自研引擎 | `engine/local.js`，纯 Node 模块，随 asar 一起打包 |

渲染层通过 `contextBridge` 暴露的 `window.hyw` 调用主进程，所有网络请求经主进程代理，渲染进程 CSP 为 `default-src 'none'`，不直接联网。

---

## 目录结构

```
hyw-desktop/
├── main.js              主进程：窗口 / 托盘 / 自愈 / 音乐接口代理 / 下载
├── preload.js           contextBridge 桥接层（window.hyw）
├── package.json         依赖与打包配置
├── .npmrc               国内镜像
├── LICENSE              Apache License 2.0
├── README.md            本文件
├── verify-credit.js     交付前自检：署名与版权
├── engine/
│   └── local.js         BR 自研引擎：本机直连各平台（搜索 / 取链 / 封面）
├── build/
│   └── icon.ico         应用图标
├── src/
│   ├── index.html
│   ├── css/
│   │   ├── theme.css    设计令牌 / 启动动画 / 提示条
│   │   └── player.css   布局与组件
│   ├── js/
│   │   ├── icons.js     内联 SVG 图标集
│   │   ├── api.js       接口封装 / 平台与音质定义
│   │   ├── lyrics.js    LRC 解析与翻译合并
│   │   ├── player.js    播放内核（队列 / 取链 / 播放模式）
│   │   └── app.js       界面与交互
│   └── assets/          图标资源
└── dist/                打包输出（正式产物在 ../version/<版本号>/）
```

---

## 开发

### 环境要求

- Node.js 18+（推荐 22）
- Windows（打包目标 win32-x64）

```bash
cd hyw-desktop
npm install
npm start
```

> Windows 上若存在 `ELECTRON_RUN_AS_NODE=1`，需先清除：
> `env -u ELECTRON_RUN_AS_NODE npm start`

---

## 打包

```bash
npm run dist     # 单文件便携版（唯一交付形态）
```

- 产出 `HYWmusic-Portable-<version>.exe`：双击即用，无需安装
- 运行数据放在系统临时目录 `%LOCALAPPDATA%\Temp\HYWmusic-Data\`，退出时清理缓存

国内网络打包需设置镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

### 交付前自检

```bash
node verify-credit.js dist/win-unpacked/resources/app.asar
```

---

## 故障排查

启动过程会写入日志：

```
%LOCALAPPDATA%\Temp\HYWmusic\startup.log
```

| 日志表现 | 说明 |
|---|---|
| 有「窗口可见」 | 窗口已正常显示 |
| 只有「创建主窗口」后中断 | 进程被外部终止，通常是杀毒软件拦截，请将安装目录加入白名单 |
| 出现「拉起安全模式实例」 | 已触发自愈，下次启动以安全模式运行 |

长期停留在安全模式（性能略低）时，删除 `%LOCALAPPDATA%\Temp\HYWmusic\safe-mode.flag` 后重启即可恢复。

---

## 免责声明

本项目仅供学习交流使用，所有音乐资源版权归原平台所有。用户使用本服务产生的任何行为均由用户自行承担法律责任。

「BR 自研引擎」直接请求各音乐平台的公开接口，仅用于学习研究，不缓存、不转存任何音频内容；接口随时可能因平台策略调整而失效。

请勿将本服务用于商业用途或大规模分发，请支持正版音乐。

---

Copyright 2026 BennerRock · Licensed under the Apache License, Version 2.0
