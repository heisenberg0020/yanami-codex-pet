# Codex 工作活动适配器

这是一组官方 command Hooks，将必要的工作活动信号交给本地小卖部。它不控制原生 Mini，不向对话注入文字，不替用户批准工具，也不把回合收尾认定为任务完成。

## 安装与官方信任

先预览将使用的绝对路径与配置，再安装：

```sh
node tools/codex-hooks/install.mjs install --dry-run
node tools/codex-hooks/install.mjs install
```

安装器默认合并 `${CODEX_HOME:-~/.codex}/hooks.json`，不改 `config.toml`。已有文件先保存逐字备份 `hooks.json.yanami-backup-<时间>-<编号>`；只添加或移除带本项目匹配标记的七个 handlers，其他条目保留。重复安装不重复注册。异常 JSON、符号链接、并发更新会停止配置更新，不会重置用户文件。

Node 默认使用运行安装器时 `process.execPath` 对应的真实绝对路径；适配器复制到 `~/Library/Application Support/YanamiSnackClub/codex-hook-runtime/adapter-<SHA256>.mjs`，并设为只读。普通安装不会原地改写已有适配器；改版会产生新的文件路径和 Hook 定义。再次安装会核对已有文件内容。应保留这个 Node 版本，或指定你长期保留的 Node 路径：

```sh
node tools/codex-hooks/install.mjs install --node /完整路径/node
```

**写入配置不代表已经启用。** 官方要求用户审核并信任确切的非托管 Hook 定义；新增或改变的定义在被信任前会被跳过。官方记录的入口是 Codex CLI 中的 `/hooks`，用它查看来源、审核和信任需要的定义。请按实际 Codex 提供的审核界面完成，不把 CLI 的审核结果未经验证就视为桌面事件已经接通。[官方信任流程](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks)

本工具从不写入内部信任状态，也不使用信任绕过参数。若用户或管理员关闭了 Hooks，安装器不会替你打开它们；只允许托管 Hooks 的环境也可能跳过这些用户 Hooks。安装记录和真实收到事件是两项独立状态。桌面版实际事件覆盖需要另行观察。

卸载只移除自己的匹配条目和安装记录，保留原配置的其他内容与备份；内容寻址脚本保留，避免删掉仍在执行的文件：

```sh
node tools/codex-hooks/install.mjs uninstall --dry-run
node tools/codex-hooks/install.mjs uninstall
```

隔离测试可用 `--config FILE --runtime-dir DIR --spool DIR --marker-file FILE`。`--spool` 会进入 Hook 的确切命令，因此改变它同样需要重新审核定义。未指定时适配器读取 `YANAMI_CODEX_SPOOL`，再回退到默认目录。涉及自定义路径的卸载请传入相同参数。

## 只保留的事件

注册的事件为 `UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PermissionRequest`、`Stop`、`Interrupt`、`SessionEnd`，不注册 `SubagentStop`。

```json
{
  "schemaVersion": 1,
  "id": "64位小写SHA256十六进制",
  "kind": "PostToolUse",
  "sessionId": "SHA256(session_id)",
  "turnId": "SHA256(turn_id)，没有时为null",
  "at": 1800000000000
}
```

- 仅接受这六个输出字段。`at` 是适配器接收时的 epoch 毫秒。
- 不存原始 session/turn/tool 标识，也不存 prompt、工具名、参数、路径、结果、模型或对话文字。身份哈希用于关联与去重，不是匿名化或防伪认证机制。
- `UserPromptSubmit`、`Stop`、`Interrupt` 必须有有效 `turn_id`，否则丢弃。`stop_hook_active: true` 的 Stop 丢弃。`SessionEnd` 可以没有 turn，不能用于发奖励。
- Start/Stop/Interrupt 的 ID 固定于事件名、session、turn；Pre/Post 还使用 `tool_use_id` 的哈希去重。工具事件缺少 tool ID 时，以及 PermissionRequest/SessionEnd，使用随机值生成仍为 SHA256 的事件 ID。
- PreToolUse 只说明即将调用；PostToolUse 只说明有工具返回过，包括失败结果。Stop 只是回合收尾信号；其他 Stop Hooks 仍可能让 Codex 继续，不能因此宣称任务成功。中断、重复、乱序和领取资格由消费端处理。[官方事件语义](https://learn.chatgpt.com/docs/hooks#hooks)

默认 spool 为 `~/Library/Application Support/YanamiSnackClub/codex-events`。适配器在目录中完成临时文件后，以原子 link 发布 `<id>.json`；重复 ID 不覆盖已在队列中的事件，保留首次接收时间。消费端应只读取 `.json` 并按事件 ID 独立去重，因为已消费文件删除后重复通知仍可能再次出现。异常终止遗留的隐藏 `.tmp` 不应视为事件。

安装记录 `codex-hooks-installed.json` 位于 spool 的父目录，仅有 `schemaVersion`、`installedAt`、`path`（配置路径），不记录信任状态。它不证明已经收到 Codex 事件。

## 非阻塞与边界

适配器只读 stdin、写本地 spool，无 HTTP 请求。输入上限 1 MiB，过大的输入或坏 JSON 被丢弃；内部看门狗在 800ms 退出。正常、异常和超时均静默退出 0，不输出 stdout/stderr。除官方始终同步的 SessionEnd 外，handlers 都设置 `async: true`、`timeout: 1`；后台事件可能乱序、在关闭会话时丢失或被取消，因此不能作为可靠审计系统。[官方后台行为](https://learn.chatgpt.com/docs/hooks#run-hooks-in-the-background)

安装器的锁只协调本安装器自身。它在备份和替换前核对配置未被其他程序修改；安装时仍应避免同时从别处编辑同一个 Hooks 文件。

## 验证

```sh
node --test tools/codex-hooks/*.test.mjs
```

测试使用隔离临时目录和真实 stdin 子进程，覆盖隐私裁剪、缺失 turn、续跑 Stop、稳定 ID、并发发布、坏输入和写入失败、输入不关闭、绝对路径转义、重复安装卸载、已有配置备份、内容变更及信任状态不被改动。模拟输入通过不等于已经观测到本机 Codex 的真实 Hooks。
