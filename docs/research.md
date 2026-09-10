Yanami 进阶桌宠：GitHub 参考与改进脑暴

研究日期：2026-09-10。建议定位：一位有八奈见特色、能表达工作状态、平时安静陪伴的桌面角色。先把原生动画做成精品，再决定是否加入独立互动程序。

这次分四路检索原生 Codex pet、传统桌宠、编程助手桌宠、角色动画工具，筛过数百条搜索结果，进一步阅读了 29 个项目的 README、配置或关键代码。其中 28 个做了浅克隆，MotionPNGTuber 只深读文档。搜索结果包含重复和无关项目，没有把命中数量当成质量；星数也没有作为推荐排序。以下是文档与源码研究，未安装运行参考程序。

当前仓库的主要短板是素材可维护性与动画编排空间，而不只是配置字段少。它已有完整 v2 图集、角色描述和一次校验结果；缺少可编辑源帧、制作工具、动作预览和可重复执行的校验器。[当前仓库](https://github.com/whileingaa/codex-pets-Yanami/tree/53fb9ecf309ae404e608226e6f7994c2a1eb910d)

本机 Codex 的加载逻辑只识别基本 manifest 字段：名称、描述、图集路径和版本等；动作触发与时序由宿主控制。因此要区分三条路线：

| 路线 | 可以获得的效果 | 实现范围 | 判断 |
|---|---|---|---|
| 原生精品素材包 | 更自然的表情、动作、16 方向朝向；更漂亮的服装、道具与固定反应 | 保持当前 Codex pet 格式，改素材与制作管线 | 最值得先做 |
| 原生 animated atlas 实验 | 每种状态内部更长、更细的连续小动作 | 使用带动画的整张 WebP 图集，保留静态版本 | 有依据、需实机验证 |
| 独立伴侣程序 | 投喂、情绪、记忆、台词、严格动作过渡、多任务联动、场景与语音 | 新增运行时或适配现有桌宠引擎 | 更复杂的互动需要走这条路线 |

还发现一个具体问题：原仓库 validation.json 把 idle 标为 7 个有效格子，但你本机 Codex 的 idle 循环只有 6 帧，第 7 格不会按该循环使用。本机 v2 每行使用的格数为 6/8/8/4/5/8/6/6/6/8/8；最后两行是 16 方向朝向。制作时应以实际宿主时序编排，而不是以所有非空格子或第三方预览器为准。这是本机代码核对结果，不代表所有历史或未来版本。

下面这些项目最值得直接借鉴。表中的 Yanami 设计是本次创意建议，并不是说参考项目或 Codex 已经有相同角色功能。

| 参考项目与实际证据 | 值得学习的能力 | 转化为 Yanami 的方向 |
|---|---|---|
| [HatchPet-CapybaraLulu](https://github.com/srwang0506/HatchPet-CapybaraLulu/blob/15447cfea25623607011be19b2c7422be1a6c43e/hatch-pet/references/desktop-smooth-state.md) | 保持 v2 网格，把完整 atlas 做成多相位 animated WebP | 原生实验：细微呼吸、眨眼、咀嚼、持续做笔记；不增加新触发事件 |
| [hatch-pet-v2-workflow](https://github.com/daizhengwei888/hatch-pet-v2-workflow/blob/0fce1aa84a734064dbaf43e5d97d398cbee124b2/README.md) | 人物标准图、逐行修复、方向检查、固定反应预设 | 锁定脸型、头身比、发饰和衣服；把通用跳跃改成角色化的五帧反应 |
| [awesome-codex-pet](https://github.com/legeling/awesome-codex-pet/blob/e270d56cc4a6b1e229b5ae01da0dc140b2cf01c4/scripts/generate-pet-previews.py) | 作品目录、逐行动画预览；另有校验与安装工具 | README 展示所有状态，发布可检查、可比较的完整作品包 |
| [VPet](https://github.com/LorisYounger/VPet/blob/2e99a42ebeff71d792118f2e8de744b773042f8d/VPet-Simulator.Core/Graph/GraphInfo.cs) | 动作区分开始、循环、结束 | 拿出点心→咬一口→嚼→收起包装；把互动做成短表演 |
| [DyberPet](https://github.com/ChaozhongLiu/DyberPet/blob/f82126b4c860bfe194b7c2e0797a9882e6569ac7/docs/art_dev.md) | 动作组合、概率、食物偏好、好感和专注状态 | 不同食物有不同反应；专注时回应轻一点；熟悉后出现更多小表情 |
| [vscode-pets](https://github.com/tonybaloney/vscode-pets/blob/2c91214beb922288cca1938cddb607abc5f806b7/src/panel/pets/cat.ts) | 每个动作有合理的下一步，并有好友互动 | 看你→托腮→想起零食→翻口袋；避免随机动作互相硬切 |
| [Ark-Pets](https://github.com/isHarryh/Ark-Pets/blob/b88c8625498ac1f857fa0841de8d183d37cefb9b/core/src/cn/harryh/arkpets/animations/AnimComposer.java) | 关键动作不可随意打断，完成后执行后继动作 | 落地、咬下去等关键几帧先完成，再响应普通事件 |
| [AgentPet](https://github.com/ntd4996/agentpet/blob/667f292e5f285b0fb2b453abf59a45d42288c756/README.md) | Codex 格式素材、编程状态联动、养成与按项目宠物 | 完成任务解锁点心、书签、纪念小票；按工作成果和休息奖励 |
| [Clawd on Desk](https://github.com/rullerzhou-afk/clawd-on-desk/blob/f834b55cf1354feb465154d698b339f50a7a088f/docs/guides/state-mapping.zh-CN.md) | 工作/通知/多任务分层表现，屏幕边缘半身模式，点击彩蛋 | 忙时做笔记、多任务时整理一摞纸，平时从屏幕边探头 |
| [UniPet](https://github.com/ydyangdan/UniPet/blob/909f6a0fe19b6cfca01b28812d06ebc955a3669d/overlay/life/planner.js) | 工作事实、情绪、动作、气泡分离；低概率待机变化 | 一套角色行为导演，决定何时说话、做多大动作、何时安静 |
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents/blob/3537e140c2094761beae748592aeb92ece8edfdd/README.md) | 工作场景、阅读/写字/离座、角色与任务对应 | 长期创意：文学社小桌面；不同工作活动对应不同位置和道具 |
| [DockCat](https://github.com/Auwuua/DockCat/blob/9dd4c4b678c68d7f5eb987ae9f284093e9d0d58d/DockCatApp/DockCat/Core/Outing/OutingRewardGenerator.swift) | 外出后带回事件与收藏；提醒队列避免堆积 | 让她去便利店，专注结束带回点心、小票或一句趣事 |
| [Pixelorama](https://github.com/Orama-Interactive/Pixelorama/blob/9263cf3636efc336aadbcc46c57dc614e57525b0/src/Autoload/Export.gd) | 分层逐帧制作、动作标签、按标签分行/列导出 | 为角色建立可编辑源文件和固定导出流程，减少反复手工拼图 |
| [AIRI](https://github.com/moeru-ai/airi/blob/13ae708541fe21a4ee5c58e54d678852aeddb8cd/packages/model-driver-lipsync/src/shared/wlipsync/vowel-driver.ts) | Live2D/VRM 伴侣；口型静音检测、平滑与表情驱动 | 远期独立版：身体、表情、嘴型分别变化，讲话时仍保留自然呼吸 |

我会把改进收敛为下面 16 个可讨论的点，优先追求“每个反应都像她”。

1. **建立一张角色标准图。** 固定脸型、瞳孔、发色、头身比、蝴蝶结、制服与光照方向。所有动作从这张图派生。现有图集的异常行有站立、下蹲等较大的姿势变化，应重点检查播放时的尺度与循环衔接；目前只是静态图检查，没有宣称已观察到桌面播放故障。适用：原生。参考：hatch-pet-v2-workflow、Pixelorama。

2. **重做三个最常见状态。** idle 做轻呼吸与短眨眼；running 做拿小本子记录或认真思考；waiting 做托腮看向你，表情温和而明确。先让每天最常看到的部分精致。原生只能使用已有状态，不承诺精准区分每一种工具操作。适用：原生。

3. **给九种状态一套角色化动作词汇。** 行走可夹着书或纸袋；挥手有袖口和发梢延迟；异常表现为愣住后整理心情；review 展示小本子等待你看；固定交互反应可以是护住零食或装作若无其事。每个动作都在当前固定帧数内设计关键姿势。适用：原生；参考：VPet、hatch-pet-v2-workflow。

4. **16 方向朝向真正保持同一个人。** 统一眼、头、发饰与肩膀的转动幅度，避免只有瞳孔细微偏移而看不出方向，也避免身体大幅扭动。最后两行应专注做好朝向，不拿来塞任意新动作。适用：原生。

5. **统一锚点和循环收口。** 站立以脚底、坐姿以臀部接触点为基准；头发与衣摆稍晚于身体回落；最后一帧能自然接回第一帧。跳跃有意位移不能被“防抖算法”抹掉。适用：原生；参考：[Shijima-Qt 锚点处理](https://github.com/pixelomer/Shijima-Qt/blob/57723f1d7a4ea4a32e5fbb90deb7febc0dd49f63/ShijimaWidget.cc)。

6. **做一张带动画的 atlas 试验。** 先只精修 idle 和 working 的连续微动作。CapybaraLulu 的做法是在每个时间相位，把一个状态的同一姿势复制到宿主可能读取的各列，再由 WebP 自己推进小动画。本机加载链保留原 WebP 字节并作为 CSS 背景显示，因此有依据认为可行，但还没做动态验收。状态切入不会重置图像时钟，动作必须能从任意相位进入；减少动态效果也未必暂停该图像。保留静态回退。它仍不会产生新事件；参考仓库的“非 idle 永久循环”另有 app patch，不属于纯素材能力。适用：原生实验。

7. **少量完成度高的衣装包。** 优先做校服日常、居家放松、雨天三套，使用同一标准脸型与锚点。每套有完整动作和预览，不只换立绘。原生可作为不同宠物手动切换；自动按时间或天气换装需要额外逻辑。适用：原生素材；参考：hatch-pet-plus。

8. **互动要有前奏和收尾。** 投喂是伸手接→看一眼→咬→嚼→把包装收好；摸头是微愣→得意→整理头发。真正能按住延长循环、在适当时机结束，需要运行时。适用：独立伴侣；参考：VPet、Ark-Pets。

9. **轻量零食偏好与收藏。** 先做 3–5 种食物和几种清晰反应，记录喜欢的点心、一起完成的任务、收集的书签。可以逐步解锁新表情，但不需要复杂货币系统。我的建议是奖励完成任务、主动休息和真实互动；AgentPet 的 token 喂养是可参考的机制，不必把消耗更多 token 当成长目标。适用：独立伴侣；参考：DyberPet、AgentPet、TamaCodex。

10. **台词先精写，再考虑聊天模型。** 按开始、等待、完成、失败、欢迎回来准备少量原创台词，设置不重复和冷却。例如完成时“好了，点心时间到了吧？”，等输入时“这个要你拿主意哦。”这些是创意示例，非原作台词。状态提醒应表达真实情况；角色口吻放在旁边。适用：独立伴侣；参考：[coding-agent-pet 的 state_map](https://github.com/golitter/coding-agent-pet/blob/5879de3c62df6695c8d60d3cfb3ffdb3e1ea592b/desktop/cross-platform/config.example.json)。

11. **把心情与工作状态分开。** “正在工作”可以同时开心、困倦或有点饿；情绪先影响眉眼、姿态、动作幅度，不必重置整个身体动画。普通待机占多数，彩蛋低频出现；通知与待确认状态优先，不被一个眨眼打断。适用：独立伴侣；参考：UniPet、Clawd on Desk、Amica。

12. **做一个更适合工作的半身模式。** 大部分时间从屏幕边缘露出头和肩膀，悬停才探出身体；需要输入或任务完成时给一次明确动作。把通知排队合并，不连续冒泡。适用：独立伴侣；参考：Clawd on Desk、DockCat。

13. **给多任务一个可读的表现。** 一个任务：小本子；多个任务：一摞便签或书；需要你处理：举起写有数量的小牌子。只有拿到真实任务事件时才显示数量，不以动画猜测工作进度。适用：独立伴侣；参考：Clawd on Desk、Pixel Agents。

14. **“去便利店”的专注小剧情。** 用户主动开始一段专注后，她出门；结束后带回一件小收藏或点心。长期形成文学社日记、小票本、书签册。是低频有内容的陪伴，制作量也比无限聊天更可控。适用：独立伴侣；参考：DockCat。

15. **文学社小场景。** 一张桌子、书架、点心袋；读资料时翻书、写作时记笔记、休息时坐回椅子。该方案需要场景渲染与事件适配。Pixel Agents 当前已有 Claude Code 实现，但其 README 把 Codex 支持列为路线图，不能直接当现成 Codex 插件。适用：远期独立场景。

16. **语音与 Live2D 作为独立升级项。** 可以先只做欢迎、完成、待确认三类短语音，再考虑自由对话。嘴型时间线可以用 Rhubarb 离线产生并人工修正；中文/日语不能假定英语识别器同样精确。高质量 Live2D 仍要专门模型和参数制作。原生 pet.json 没有音频或实时模型接口。适用：远期独立伴侣；参考：AIRI、Rhubarb、pixi-live2d-display。

为了让这个 repo 本身更精致，我建议增加下面这些交付内容。它们都能支持原生精品版，不依赖先做大型桌宠应用。

| 仓库新增内容 | 解决的问题 | 如何判断完成 |
|---|---|---|
| 角色标准图与分层源文件 | 每次修改容易换脸、换比例 | 各动作并排时仍是同一人物 |
| 按动作整理的源帧与版本说明 | 现在只能改最后一张大图 | 单独修一行动作即可重新导出 |
| 针对本机格式的导出规则 | 格数、排列、时序容易弄错 | 导出严格符合目标宿主；禁止任意 trim/packed 重排 |
| 可交互预览页 | 大图好看不代表桌宠尺寸好看 | 能选状态、逐帧、慢放、看实际尺寸和深浅背景 |
| 质量检查工具 | validation.json 是一次结果 | 每次导出能重查尺寸、透明度、越界、缺帧和空格 |
| 动作人工审阅清单 | 单纯像素统计看不出换脸和动作别扭 | 检查循环收口、锚点、道具遮挡和方向一致性 |
| 静态与实验包分别发布 | 实验动画出现兼容问题时难回退 | 标清目标版本，能切回静态素材 |
| 安装说明、完整预览与素材来源 | 当前 README 信息太少 | 新用户无需猜路径，能看见所有动作并了解来源 |

原生导出仍保持简单 pet.json。更丰富的制作参数应放在自己的设计文件里，由构建工具使用；独立版的行为、台词、存档也使用自己的配置。这样配置可以丰富，但每个字段都有真正读取它的程序，不会出现“写了 hunger=100 却没人解释它”的假功能。

执行顺序上，我建议先做：**角色标准图 → idle/running/waiting 三个关键状态 → 全部状态与 16 方向统一 → 预览和校验工具**。这一步能独立交付一个更漂亮的原生 Yanami。然后给 animated atlas 做小范围试验；若你最想要的是投喂、台词、收藏，再选独立引擎验证素材导入和当前桌面版 Codex 的事件适配。

独立路线里，AgentPet 可优先研究 Mac 养成体验，UniPet 适合研究事件与行为分离，Clawd on Desk 适合研究成熟交互与 Codex pack 导入。不能把它们的 Codex CLI 支持直接等同于你当前桌面版所有事件都可用；这会是原型阶段首先验证的一项。

其余实际深入阅读的参考也保留在这里，方便以后选方向时追溯。

| 项目与资料 | 补充价值 | 使用时的实际边界 |
|---|---|---|
| [hatch-pet-plus](https://github.com/leduy-it/hatch-pet-plus/blob/08265025817432bd58fb2ddcd9d2d002ad4c7e23/docs/EVOLUTION.md) | 画风变体、逐行动作预览、进化阶段格式 | 文档明确 stages 不被原生 Codex 识别，需其他宿主 |
| [codex-anime-character-pet](https://github.com/Shuming-0/codex-anime-character-pet/blob/b9ec4bab8e22d0286e648de8bf98cedb2bccb79a/README.md) | 与 Yanami 接近的 Q 版人物标准图和 v2 包结构 | 未见完整生成管线；未见仓库级许可 |
| [codex-pokepets](https://github.com/dnnyngyen/codex-pokepets/blob/3bff0e1def268a3504f9cba1bec467a5d901d20b/README.md) | 将已有连贯动画重新封装、同角色多造型 | 主要是素材路线参考，抽查包为默认 v1；人物素材另看条款 |
| [TamaCodex](https://github.com/Alichua/TamaCodex/blob/10623b1245d2d61b22655a012c4964971721d9f3/tamacodex/state.py) | XP、精力、心情、关系状态与外部伴随窗口 | 需要额外控制器，非纯 pet.json 功能 |
| [codex-pet-limit-rings](https://github.com/petergpt/codex-pet-limit-rings/blob/9962bd0c4df0c2f16e7e10af0b6c23db84702878/README.md) | 不改角色图集，用独立覆盖窗增加信息层 | 依赖内部状态与用量接口；本轮未验证兼容，不列首期 |
| [Shijima-Qt](https://github.com/pixelomer/Shijima-Qt/blob/57723f1d7a4ea4a32e5fbb90deb7febc0dd49f63/README.md) | 每帧锚点、镜像、屏幕边界 | 已归档停维护，只作工程设计参考 |
| [eSheep desktopPet](https://github.com/Adrianotiger/desktopPet/blob/ab82f31f3c6a9b922edc798d09eb6e437db18a99/src/Tools/XmlToDot.cs) | XML schema、行为图、编辑器 | 桌面版 Windows；未找到明确许可证，不直接搬代码 |
| [coding-agent-pet](https://github.com/golitter/coding-agent-pet/blob/5879de3c62df6695c8d60d3cfb3ffdb3e1ea592b/desktop/cross-platform/config.example.json) | 配置化事件、逐帧时长、角色台词 | 独立 Tauri 程序，配置不适用于原生 pet.json |
| [agent-pets](https://github.com/ifBars/agent-pets/blob/9db7601aba9c5118f8b14b40fbb13ce6f8a5890b/src/main/providers/codex.ts) | 素材与事件源分离、手动模式 | Codex 状态由会话文件和时间窗口推断，有版本耦合 |
| [Aseprite](https://github.com/aseprite/aseprite/blob/375989a61c3425cd4e8cdedfcfcca4bdfef7e1d9/src/app/cli/app_options.cpp) | 精确的 batch/tag/layer/atlas 导出 | 项目主体 EULA；固定格子模式不能照搬 packed/trim |
| [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display/blob/31317b37d5e22955a44d5b11f37f421e94a11269/docs/docs/motions_expressions.md) | 动作优先级、预加载、声音同步 | 较旧的 PixiJS v6 路线；不是任意多轨混合引擎 |
| [Amica](https://github.com/semperai/amica/blob/ca2415c77d20ec41dd4fcf917dbb0e97961ddf08/docs/overview/emotion-system.md) | 显式情绪标签到模型表情映射 | 最近推送在 2025 年；模型须有对应表情 |
| [AITuberKit](https://github.com/tegnike/aituber-kit/blob/75037596d0dea4ac3ee74f06fe841f1bf87e9f91/src/features/messages/live2dHandler.ts) | 同一情绪有多个表情，动作结束回 idle | v2 使用自定义非商用/商用许可，非宽松开源底座 |
| [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/9b9573cd21b253c9ba58739bbd1aa0b50b991bff/README.adoc) | 录音生成 6–9 种嘴型的可编辑时间线 | 非英语用 phonetic，通常需更多人工修正 |
| [MotionPNGTuber](https://github.com/rotejin/MotionPNGTuber/blob/main/README.md) | 短循环视频加嘴型覆盖，介于立绘与 Live2D 之间 | 本次只读文档；项目及 Mac 支持均标实验性 |

平台与许可只影响“能否直接采用”，不影响学习设计：VPet 是 Windows/WPF，Ark-Pets 当前仍只支持 Windows；DyberPet 的公开 macOS 代码落后于最新 Windows 发布；DockCat 是原生 Mac，但有非商用限制。代码许可、运行时许可和角色素材许可需要分别核对，借鉴动作机制不等于复制人物素材。

这轮最有把握的产品取舍是：先让她在沉默时也有角色感，再让互动有记忆、有节奏。首期最值得投入的是统一画风、三种高频动作、一个专属反应和可靠的素材预览管线。
