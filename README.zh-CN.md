<p align="center">
  <img src="public/icon.png" width="96" alt="True Vibe Coder 图标" />
</p>

<h1 align="center">True Vibe Coder</h1>

<p align="center"><strong>舒服地远程工作。</strong></p>

<p align="center">
  把 Apple TV Remote 变成 macOS 的快捷键、光标、连续滚动和小目标选择工具。
</p>

<p align="center">
  <a href="README.md">English</a>
  ·
  <a href="#从源码构建">从源码构建</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-111820?style=flat-square" alt="macOS" />
  <img src="https://img.shields.io/badge/input-Apple%20TV%20Remote-111820?style=flat-square" alt="Apple TV Remote" />
  <img src="https://img.shields.io/badge/license-MIT-111820?style=flat-square" alt="MIT License" />
</p>

![True Vibe Coder 把 Apple TV Remote 变成 macOS 输入界面](docs/images/hero.png)

## 为轻松工作设计的输入界面

True Vibe Coder 是一款 macOS 工具，让你可以从沙发、桌边或房间另一侧控制电脑。它保留 Siri Remote 简单直接的物理交互，同时加入可控的键盘、鼠标、滚动和光标辅助能力。

### 映射遥控器按键

![把 Apple TV Remote 按键映射为快捷键、长按、鼠标点击和应用命令](docs/images/mapping.png)

学习一个物理按键后，可以给它分配单键、组合键、鼠标点击或专用命令。长按动作会保持正确的修饰键释放时序，适配依赖 key-up 顺序的快捷键；遥控器预览也会同时显示已保存动作和实时输入反馈。

### 用触控面移动和滚动

![内圈控制光标，外圈控制连续滚动](docs/images/touch.png)

在受支持的银色 Siri Remote 上，clickpad 内圈负责精确光标移动，围绕外圈做圆周运动则变成连续滚动。方向锁定和加速度机制让长页面的滚动保持连贯。

### 吸附到较小控件

![针对小型可访问控件的磁吸光标辅助](docs/images/magnet.png)

Magnetic Cursor 使用 macOS 辅助功能信息识别较小控件。光标接近目标时会平滑吸附，小幅移动不会立即逃离，明确向外移动才会脱离；吸附状态下还可以用遥控器方向键在附近的可访问目标之间跳转。

## 当前支持

- Apple TV Remote 单击、长按、组合键、鼠标点击和触控面映射
- 内圈光标移动与外圈连续滚动
- 针对 macOS 辅助功能所暴露的小型控件进行磁吸辅助
- 与遥控器型号对应的实时按键和触控反馈
- 持久化遥控器映射和蓝牙耳机媒体键映射
- 关闭主窗口后继续驻留菜单栏
- **Release to Apple TV** 会在交还设备前关闭 HID 访问

## 连接遥控器

1. 打开 Mac 的**系统设置 → 蓝牙**。
2. 暂时断开 Apple TV 电源，或把遥控器带离 Apple TV 的连接范围，避免它优先连回电视。
3. 银色第二、三代遥控器同时按住 **Back + Volume Up** 五秒；黑色第一代使用 **Menu + Volume Up**。
4. 遥控器出现在附近设备后点**连接**，再打开 True Vibe Coder，选择 **Refresh** 或 **Connect Remote**。
5. macOS 询问时授予辅助功能权限。键盘、鼠标、滚动和目标吸附都依赖该权限。

Apple 官方只明确说明了遥控器与 Apple TV 的配对流程。把它作为通用 Mac 输入设备属于非官方工作流，而且遥控器本身不支持 AirPods 式的 Mac 与 Apple TV 自动切换。

## 交还给 Apple TV

重新连接 Apple TV 前，在应用中选择 **Release to Apple TV**。然后把遥控器放在 Apple TV 附近，同时按住 **Back + Volume Up** 五秒。应用会释放 WebHID 和原生 HID 访问，并暂停自动重连。

## 技术边界

- Magnetic Cursor 依赖 macOS 辅助功能树。自绘或没有正确暴露辅助功能信息的控件可能无法成为磁吸目标。
- 蓝牙连接归属仍由遥控器与操作系统管理。True Vibe Coder 可以释放自己的 HID 访问，但无法给遥控器增加自动设备切换能力。
- 当前键盘与光标输出只支持 macOS。

## 从源码构建

```bash
npm install
npm run dev
```

构建原生 helper 和桌面应用：

```bash
npm run build
```

Apple Remote 原生读取位于 `helpers/apple-remote-helper.swift`，渲染进程输入逻辑位于 `src/hooks/useAppleRemote.ts`，键鼠模拟、磁吸和 helper 生命周期位于 `electron/main/index.ts`。

## 许可

MIT。原始版权声明与许可条款见 [LICENSE](LICENSE)。
