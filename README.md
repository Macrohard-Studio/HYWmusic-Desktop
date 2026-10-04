# HYWmusic

HYWmusic（何意味音乐）**桌面音乐播放器** · Windows / Electron。

界面参考 LX Music 的布局：左侧导航 + 顶部搜索 + 歌曲列表 + 底部播放控制栏 + 歌词面板。
音源来自何意味音乐开放接口，**开箱即用，无需注册登录**。

- **版本**：v1.0.0-beta1
- **许可证**：[Apache License 2.0](./LICENSE)

---

## 功能

### 搜索与播放

| 能力 | 说明 |
|---|---|
| 多平台搜索 | 网易云 / QQ音乐 / 酷狗 / 酷我 / 咪咕 / 汽水，可「全部」聚合 |
| 双搜索引擎 | **LX 引擎**（官方同源，准确率高）/ **聚合引擎**（跨源并行，响应更快） |
| 音质选择 | 128K / 320K / FLAC 无损 / FLAC 24bit / Hi-Res，播放中切换会重新取链 |
| 真实播放 | HTML5 Audio 内核，支持拖动进度、音量调节、缓冲进度显示 |
| 自动换源 | 当前平台取链失败或音质受限时，自动在其他平台搜索同名歌曲重试 |
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

- 深色 / 浅色主题，标题栏颜色同步
- **系统托盘**：关闭时可选最小化到托盘或直接退出，支持「不再提醒」
- **后台降耗**：隐藏到托盘时暂停动画与轮询
- 单实例运行，重复双击唤出已有窗口
- **安全模式自愈**：检测到 GPU / 沙箱导致启动失败时自动以安全模式重启

---

## 技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 33 |
| 主进程 | Node.js（`main.js`）— 窗口、托盘、HTTP 代理、文件下载 |
| 渲染层 | 原生 HTML / CSS / JavaScript，无框架、无构建步骤 |
| 音频 | HTML5 `<audio>` |
| 打包 | `@electron/packager`（便携版）、`electron-builder`（NSIS 安装包 / 单文件便携版） |

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
└── dist/                打包输出
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
npm run pack     # 便携版（文件夹）
npm run dist     # 安装包 + 单文件便携版
```

- 便携版产出 `HYWmusic-win32-x64/`，**分发时需整个目录一起拷贝**，单独拿出 exe 无法运行
- 安装版产出 `HYWmusic-Setup-<version>.exe`：向导式、中文界面、免管理员权限、可自定义安装路径、自带卸载程序

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
%APPDATA%\HYWmusic\startup.log
```

| 日志表现 | 说明 |
|---|---|
| 有「窗口可见」 | 窗口已正常显示 |
| 只有「创建主窗口」后中断 | 进程被外部终止，通常是杀毒软件拦截，请将安装目录加入白名单 |
| 出现「拉起安全模式实例」 | 已触发自愈，下次启动以安全模式运行 |

长期停留在安全模式（性能略低）时，删除 `%APPDATA%\HYWmusic\safe-mode.flag` 后重启即可恢复。

---

## 免责声明

本项目仅供学习交流使用，所有音乐资源版权归原平台所有。用户使用本服务产生的任何行为均由用户自行承担法律责任。

请勿将本服务用于商业用途或大规模分发，请支持正版音乐。

---

Copyright 2026 BennerRock · Licensed under the Apache License, Version 2.0
