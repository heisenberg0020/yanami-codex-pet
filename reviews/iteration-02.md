Iteration 02 — REJECTED / 退回

日期：2026-09-10。输入为 iteration-01 六格动作源片，通过内置 imagegen 请求背景提取，具体提示词留在 assets/source/iteration-02/prompts.json。

三张输出仍为 1536×1024 RGB 图片，没有 alpha 通道。检查结果和文件哈希见 source-checks.json。棋盘依旧是实际像素，因此不允许打包成候选。running 第三格还出现了偏离写字循环的手部姿势，需要下一次动作修订回归连续性。

独立审阅在 reviews/visual-iteration-01.md 指出的身份/比例问题也没有被背景修订解决。下一次美术修改应回到原版角色参考，只作小幅动作编辑；不能因为背景成功透明就自动接受混用。

自动结构检查：fail。
新旧身份相容：仍未解决。
原速动画审阅：not-run（源素材未过硬门槛）。
Codex 安装：not-run。
真实 Codex 验收：not-run。

决策：退回。尚无可安装的精修候选包；原版宠物保持原样。
