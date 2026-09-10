# 八奈见的小卖部

保留原版八奈见动作的本地陪伴小卡片。专注一会儿，让杏菜带回点心；投喂后把一起尝过的味道收进收藏册。

**v0.2 已实现：零食收藏 + 专注采购 + Codex 协作采购。** 可在独立 Mac 窗口或 Codex 内置浏览器打开，二者共享本机存档。可选官方 Hooks 把工作事件送入小卖部，需先审核信任。原生 Codex Mini 保持原版；工作气泡和点心操作显示在小卖部中。真实桌面工作事件仍需完成首次接入验收。

## 已经能做什么

- 可选 Codex 协作采购：每 3 次含工具活动的回合收尾，产生 1 份待领取点心；状态、气泡和原版动作随工作事件变化。
- 15 / 25 / 45 分钟专注采购，分别带回 1 / 2 / 3 份点心；支持暂停、继续、取消。
- 30 秒体验采购，方便快速走完整个流程；小票明确标注体验，专注分钟为 0。
- 6 种点心、24 句投喂短句、12 则采购见闻、3 种偶遇贴纸。初次打开每种点心各有一份。
- 零食库存、首次投喂、分享次数、采购小票和纪念物均在本机保存。
- 关闭窗口后计时继续；退出应用后下次打开按真实时间恢复。重复领取不会增加第二份奖励。
- 减少动态、窄屏布局、键盘关闭弹窗、保存中断后确认恢复。

## 开始使用

已构建的本机应用位于 `dist/八奈见的小卖部.app`，此目录不随Git源码分发，其他机器需按下方步骤构建。双击后打开菜单栏小卖部；关闭窗口仍可从菜单栏重新打开。当前构建适用于 Apple Silicon、macOS 13.5 或更新系统，包含 Node，无需另装运行环境。它是本机构建的版本，未作为已公证安装包发布。

从源码运行网页，需要 Node.js 22.12 或更新版本：

```bash
npm ci
npm run build
npm start
```

打开 [小卖部本地入口](http://127.0.0.1:17653/)。保持本地服务或菜单栏应用运行，即可在 Codex 内置浏览器访问这个地址。

构建菜单栏应用：

```bash
npm run mac:build
```

完整构建参数与应用退出行为见 [Mac 启动说明](macos/README.md)。同一份数据只启动一个本地服务；浏览器和原生窗口连接它。开发或验收第二个服务时，为其设置独立端口和独立存档路径。

## 接上 Codex 工作过程

```bash
npm run codex:install -- --dry-run
npm run codex:install
```

安装器增加七个官方事件处理器，使用本机绝对 Node 路径和内容寻址脚本；已有 `hooks.json` 会先备份，保留其他配置。**安装不代表已经获信任或收到真实事件。** 在 Codex CLI 输入 `/hooks`，审核并信任标为 `Yanami Snack Club · minimal activity event v1` 的条目。随后在加载了新配置的 Codex 回合中实际使用工具，检查小卖部的“最后更新”和三格进度。

收尾事件不等于任务成功或测试通过，也不计入人的专注分钟。没有工具活动、先中断的回合不奖励；同一回合只回馈一次。可随时用 `npm run codex:uninstall` 移除本项目的 Hook 条目，保留点心存档。

详见 [联动设计与验收](docs/Codex工作联动.md)和 [Hook 安装、审核与卸载](tools/codex-hooks/README.md)。

## 存档与恢复

默认保存到 `~/Library/Application Support/YanamiSnackClub/state.json`，另有最近一次有效备份。存档不上传 GitHub，也不调用外部聊天或图像接口。目录、备份与服务日志详见 [Mac 说明](macos/README.md)。

若看到“确认这一步”，点击它即可用原操作记录确认；不要把它当成再次领取。刷新同一个标签页也能恢复这条待确认记录。程序会校验存档，主文件损坏时保留损坏副本并尝试恢复备份，同时显示说明；没有可用备份时不会静默清空。

计时基于本机时钟，不判定你是否一直专注，也不提供跨设备同步或系统提醒。v0.2 增加可选的 Codex 事件接入；从 v0.1 升级时保留原始存档副本，再迁移到含联动记录的 v2 存档。原有库存、收藏、暂停计时和待确认操作都保留。

## 设计、执行与验收

- [可执行计划](docs/首版执行计划.md)：范围、状态规则、实现顺序、验收门槛。
- [界面设计](docs/小卖部界面设计.md)：配色、排版、动作和资源约定。
- [v0.2 联动验收记录](reviews/codex-integration-v1/review.md)：模拟端到端、实际本机安装与真实事件待验收边界。
- [v0.1 验收记录](reviews/companion-v1/review.md)：实际交互、发现并修复的问题及未覆盖范围。
- [后续扩展方案](docs/扩展方案.md)：其他方向留待这一版体验后选择。

```bash
npm test
npm run build
python3 -m unittest discover -s tests -v
```

GitHub 持续检查领域规则、存档、请求恢复、原版动画时序、素材管线和网页构建。原版图集 SHA-256 为 `41d2ed83cdd7285a8cbf441fc530b11bce7e6e0c0345192aaf3b2e6a19fa3fe3`，网页打包后的字节也应一致。

| 目录 | 用途 |
|---|---|
| `companion/` | 状态、内容、存档、本地服务和 React 页面 |
| `macos/` | 菜单栏应用及构建工具 |
| `assets/upstream/yanami-anna/` | 原版图集与来源记录 |
| `assets/source/companion-v1/` | 本轮点心插画原始输出 |
| `reviews/companion-v1/` | 概念图、生成提示词和实际验收 |
| `preview/` / `tools/` | 历史素材制作及对照检查工具 |

原先的精修 candidate-001 已退出主线，以下制作工具仅保留为历史实验。后续玩法读取原版图集，无需选择“八奈见杏菜·精修”。

## 历史候选的制作与构建

需要 Python 3，图像依赖由 `requirements.txt` 声明。建议在仓库内建立独立环境，再查看工具帮助：

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 tools/pet_tool.py --help
python3 tools/pet_tool.py build --help
```

用上游素材重建一个基线包，可检查整个制作流程；这一步本身不会让画面变得精致：

```bash
python3 tools/pet_tool.py build \
  --base assets/upstream/yanami-anna/spritesheet.webp \
  --output work/baseline-check
```

三个精修状态分别使用一张 **3 列 × 2 行的六帧透明 PNG**，按先左到右、再上到下读取。仓库已保存 candidate-001 的原生尺寸素材，以下命令重建本轮候选。已被退回的生成稿不能直接用于候选构建：

```bash
python3 tools/pet_tool.py build \
  --base assets/upstream/yanami-anna/spritesheet.webp \
  --output pets/yanami-anna-refined \
  --replace idle assets/source/iteration-03-native/idle.png 3x2 \
  --replace waiting assets/source/iteration-03-native/waiting.png 3x2 \
  --replace running assets/source/iteration-03-native/running.png 3x2 \
  --fit native
```

工具保留其余状态的基线素材，按本次核对的 Codex v2 帧数清空不用的格子。默认 `--fit contain` 按源格比例适配；已经制作为每格 192 × 208 的素材可使用 `--fit native`。不能依靠逐帧随意缩放掩盖人物比例不一致。

构建产物包括 `pet.json`、`spritesheet.webp` 与 `validation.json`。修改素材后重新构建和检查，不手工把旧报告复制到新包里。

```bash
python3 tools/pet_tool.py validate pets/yanami-anna-refined \
  --json reviews/current-validation.json
```

`reviews/current-validation.json` 是便于当前查看的报告。每次正式审阅还需按[记录规则](docs/acceptance.md#每轮审阅记录)存一份带候选编号的结果，避免下一轮覆盖证据。

## 预览

在仓库根目录运行：

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

打开 [Yanami 预览](http://127.0.0.1:8765/preview/)。详细操作见 [preview/README.md](preview/README.md)。

依次检查原版/候选对照、深浅背景、实际小尺寸、暂停逐帧和原速播放。预览的“原生播放”按已核对的本机时序模拟；“循环审阅”和慢放用于找问题，不代表 Codex 会永久播放该动作。真正的宿主加载、缓存、交互与状态触发仍需实际验收。

## 历史候选的安装与实际验收

本节保留旧工具的用法。当前扩展主线不要求安装或验收精修候选，继续使用原版即可。

检查合格后，把候选包复制到独立的宠物目录：

```bash
python3 tools/pet_tool.py install pets/yanami-anna-refined
```

默认候选安装目录是 `~/.codex/pets/yanami-anna-refined`。安装工具会核对内容并备份已存在的候选包；它不会替你在 Codex 中选中宠物，也不覆盖原版的目录。

本次操作环境的安全工具限制了自动控制 Codex 界面，因此最后一步需要用户手动完成：在 Codex 设置中的 Mini / My pets 选择 **八奈见杏菜·精修**，必要时刷新列表，再显示 Mini。不同版本入口名称可能不同，以实际界面为准。

请按[真实 Codex 检查表](docs/acceptance.md#第三层真实-codex-验收)记录看到的状态、问题和截图或短录屏。候选未在 Codex 中完成验收前，版本继续标为 **candidate**；发现脸型漂移、动作跳变或白边就退回修改。若要回退，在宠物列表重新选择原来的“八奈见杏菜”；卸载候选并非回退的必要步骤。

## 来源与许可

基于 [whileingaa/codex-pets-Yanami](https://github.com/whileingaa/codex-pets-Yanami) 的固定源码快照制作。上游未发现明确的仓库级许可证；本仓库不会替原作者或角色权利人授予第三方素材许可。上游来源、基线文件与新工具的许可状态见 [THIRD_PARTY.md](THIRD_PARTY.md)。
