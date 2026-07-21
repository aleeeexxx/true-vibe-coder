# ture vibe coder

ture vibe coder 把 Apple TV Remote 变成一块轻松、低干扰的 macOS 输入界面，可映射快捷键、控制光标与滚动，并让光标吸附到较小的可访问性控件。产品定位是从沙发或房间另一侧完成轻量工作、编程和媒体控制。

## 主要能力

- Apple TV Remote 单击、长按、组合键、鼠标点击和触控面映射
- 针对小按钮的磁吸光标辅助
- “交还给 Apple TV”会真正关闭 WebHID 和原生 HID 占用，并暂停自动重连
- 遥控器按键和触控面的实时反馈
- 持久化遥控器与耳机映射
- 关闭主窗口后继续驻留菜单栏

## 在 Mac 与 Apple TV 之间切换

Apple TV Remote 本身不支持 AirPods 式的自动设备切换。在 ture vibe coder 中先点“Release for Apple TV”。回到 Apple TV 时，把遥控器放在 Apple TV 附近，同时按住 Back 和 Volume Up 五秒。

回到 Mac 时，先打开“系统设置 → 蓝牙”，暂时断开 Apple TV 电源，或把遥控器带离其接收范围。银色第二、三代遥控器同时按住 Back 和 Volume Up 五秒；黑色第一代使用 Menu 和 Volume Up。遥控器出现在附近设备后点“连接”，再回到 ture vibe coder 点“Refresh”或“Connect Remote”。Apple 官方只明确支持这款遥控器与 Apple TV 配对，把它用作 Mac 输入设备属于非官方流程。

## 开发

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

MIT。原始版权声明与许可条款见 `LICENSE`。
