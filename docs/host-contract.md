# 当前 Codex 宿主契约

本项目在 2026-09-10 只读核对了本机 ChatGPT 桌面应用内的 Codex 实现。以下是该版本的实际加载和播放规则，不能承诺未来版本保持相同，也不把第三方预览器当作官方规范。

本机包信息：`CFBundleIdentifier=com.openai.codex`，版本 `26.903.61454`，build `8378`，macOS `26.5.1`。这些信息来自应用 `Info.plist` 与系统版本只读查询，并不代表已在该版本中完成候选加载或视觉验收。

核对宿主：ChatGPT.app `26.903.61454`，build `8378`，bundle identifier `com.openai.codex`，macOS `26.5.1`。

核对位置：`Contents/Resources/app.asar` 内 `.vite/build/src-J2PvP4xj.js` 的 `J1 / e0 / Z1`，以及 `webview/assets/app-initial-1b87ae739476.js` 的 `LN / mer / ser / Cer`。本项目不调用这些内部接口，也不修改应用。

## 包与像素布局

一个包包含 `pet.json` 和 `spritesheet.webp`。加载目录为 `${CODEX_HOME:-~/.codex}/pets/<目录名>/`，运行时标识由目录名形成 `custom:<目录名>`。

```json
{
  "id": "yanami-anna-refined",
  "displayName": "八奈见杏菜·精修",
  "description": "Yanami Anna, a refined companion for Codex.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

v2 是 1536×2288 像素、8列×11行，每格192×208。当前播放表使用73格；本项目要求另外15格的alpha完全为0。行列从0计数。透明背景不能用白色、棋盘格或色键颜色伪装。

原版 Yanami 的 row0/column6 有额外人物图。本期静态导出会清空这一格：当前宿主的 **idle循环只有column0–5六帧**。验证文件中“7个非空格”不等于宿主会播放7帧。除明确替换的行和这一额外格外，打包工具逐像素核对原版有效格不变。

## 动作表

| 行 | 原生状态 | 有效格数 | 实际帧时长，毫秒 |
|---|---|---:|---|
| 0 | idle | 6 | 1680, 660, 660, 840, 840, 1920 |
| 1 | running-right | 8 | 前7帧120，末帧220 |
| 2 | running-left | 8 | 前7帧120，末帧220 |
| 3 | waving | 4 | 前3帧140，末帧280 |
| 4 | jumping | 5 | 前4帧140，末帧280 |
| 5 | failed | 8 | 前7帧140，末帧240 |
| 6 | waiting | 6 | 前5帧150，末帧260 |
| 7 | running | 6 | 前5帧120，末帧220 |
| 8 | review | 6 | 前5帧150，末帧280 |
| 9–10 | 指针朝向 | 16 | 按方向选静态姿势，非计时循环 |

idle 原始时长为 `[280,110,110,140,140,320]`，宿主循环会整体乘6，上表已包含这一因子；一轮为6.6秒。其它状态各播3轮后转回idle循环，不保证“工作中一直打字”。减少动态效果时宿主计时器仅展示状态首帧。

方向用 `atan2(dx, -dy)`：屏幕上方为0°，顺时针每22.5°一个姿势。方向索引 `i` 对应行 `9 + floor(i/8)`、列 `i % 8`；即上、右上附近、右、右下附近、下、左下附近、左、左上附近。不要把左到右排列误当作转头顺序。

图集只改变这些状态中的视觉表演。`running` 表示工作状态，不能与左右移动行混淆。row4 可画成一个固定指针反应，但新增随机动作、喂食按钮、声音、长期记忆或成长规则没有相应manifest字段。

## 本期只导出静态 WebP

宿主读取原WebP字节、转data URL并用CSS背景展示，未转PNG；这给 animated atlas 留下实验空间。但其图像时钟共享且状态进入不重播，并可能继续动画而绕过减少动态效果。本期不采用这一路径：工具拒绝多帧输入，输出单帧、无损、保留透明度的WebP。

## 打包输入

```sh
python tools/pet_tool.py build \
  --base assets/upstream/yanami-anna/spritesheet.webp \
  --output pets/yanami-anna-refined \
  --replace idle path/to/idle.png 3x2 \
  --replace waiting path/to/waiting.png 3x2 \
  --replace running path/to/working.png 3x2
```

网格按从左到右、从上到下读取。支持任何原生行名或0–10行号；每行仍必须满足宿主有效帧数。源图大小必须能整除声明的列数和行数；多出的源格必须透明。

默认 `--fit contain` 对每个完整源格做同一比例的等比缩放与居中留白，不分别裁角色、移动基线、改表情或插帧。因此源图本身必须完成跨帧人物注册。`--fit native` 则要求源格已经是192×208，逐像素搬运。无行替换时也可重打包基线，清除原版额外idle格。

输出为 `pet.json`、`spritesheet.webp`、`validation.json`。报告记录源文件/结果哈希、替换行、清理格、保留有效格核对和质量提示。工具会在验证通过后才替换运行时文件；失败时报告仍会留下，已有运行时文件不替换。

## 校验与验收边界

```sh
python tools/pet_tool.py validate pets/yanami-anna-refined --json reviews/package-validation.json
python -m unittest discover -s tests -v
```

尺寸错误、无透明通道或无透明背景、有效格空缺、额外格非透明、可见像素触及单格边界导致疑似切断/格子错位会失败。边缘检测忽略alpha不超过8的极弱残留；空格则要求所有alpha严格为0。

工具记录每帧bbox、底边位置和可见面积。跨帧基线、轮廓面积或首尾差异较大仅给提示，跳跃或伸手等合理动作不会因移动幅度本身失败。自动通过仅证明包结构；脸型、手部、服装、演出、循环观感仍需人工看预览及实际桌面验收。

## 独立候选安装

```sh
python tools/pet_tool.py install pets/yanami-anna-refined
```

默认仅写 `~/.codex/pets/yanami-anna-refined`（尊重CODEX_HOME）。安装器拒绝以 `yanami-anna` 为目标；不改原版或选中状态。先验证并暂存、核对两个运行时文件的SHA-256，再把旧候选移动到 `pets/.backups/yanami-anna-refined-<UTC时间>-<随机标识>`，最后原子替换并再次核对。失败时恢复旧候选。

`--destination` 供自定义CODEX_HOME或隔离测试使用，目录末级仍必须为 `yanami-anna-refined`。工具从不控制Codex UI、访问内部IPC、写config或写全局状态；文件安装成功与已经在桌面选中/显示是两项独立验收。
