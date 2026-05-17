# AutoPipeline — Product Requirements Document

## Problem Statement

运维和开发人员在日常工作中需要频繁执行多步骤自动化任务：部署代码到远程服务器、批量执行命令、在多台机器间传输文件。现有工具要么是纯命令行（难以复用和可视化），要么是重量级 CI/CD 平台（Jenkins、GitLab CI）需要服务端部署，不适合个人或小团队的桌面使用场景。

用户需要一个轻量级的 Windows 桌面应用，能够：
- 可视化定义多步骤自动化流程（支持并行）
- 一键执行，实时查看输出
- 内置 SSH 远程连接和文件传输能力
- 步骤间传递数据
- 失败时从断点恢复

## Solution

AutoPipeline 是一个 Windows 桌面应用（Electron + React），提供可视化 Pipeline 编排和执行能力，内置 SSH/SFTP 远程管理。用户通过 DAG 流程图编辑器定义 Pipeline，每个节点（ExecutionUnit）包含一组顺序执行的 Commands（Shell 脚本或文件传输），节点间通过图的拓扑关系表达顺序和并行。执行时实时流式展示输出，支持取消、从失败点恢复。另外提供独立的双面板文件浏览器用于日常文件管理。

## User Stories

1. As a DevOps engineer, I want to define a Pipeline as a visual DAG of ExecutionUnits, so that I can see the execution flow and parallelism at a glance.
2. As a user, I want to add Shell Commands to an ExecutionUnit that run on a remote Server, so that I can automate deployment tasks.
3. As a user, I want to add Shell Commands that run locally (PowerShell or cmd), so that I can mix local and remote operations in one Pipeline.
4. As a user, I want to add Transfer Commands that upload or download files via SFTP, so that I can move artifacts between local and remote as part of my Pipeline.
5. As a user, I want to configure parallel execution by forking the DAG into multiple branches, so that independent tasks run concurrently and save time.
6. As a user, I want Commands to declare Named Outputs via `::set-output name=key::value`, so that downstream Commands can reference their results.
7. As a user, I want to reference upstream Named Outputs via `{{unitName.commandName.key}}` template syntax in my scripts, so that data flows between steps.
8. As a user, I want to define Pipeline Parameters (string, number, boolean, select) that are prompted at trigger time, so that I can reuse the same Pipeline with different inputs.
9. As a user, I want to create named Shell Sessions that preserve working directory and user identity, so that later Commands can reuse the same shell state.
10. As a user, I want to configure `on_failure` per Command (stop, continue, skip_unit), so that I control how failures propagate.
11. As a user, I want to set an optional timeout per Command, so that hung processes don't block my Pipeline forever.
12. As a user, I want to cancel a running Pipeline and have in-flight processes terminated gracefully (SIGINT → 3s grace → force kill), so that I can abort safely.
13. As a user, I want to re-run a failed Pipeline from scratch with pre-filled Parameter values, so that I can retry quickly.
14. As a user, I want to resume a failed Pipeline from the exact Command that failed, so that I don't re-execute already-succeeded steps.
15. As a user, I want the resume to use the current Pipeline definition (not the snapshot), so that I can fix a bug and continue from where it broke.
16. As a user, I want each Run to snapshot the full Pipeline definition, so that I can review exactly what was executed historically.
17. As a user, I want real-time streaming output during execution with per-Command collapsible review after completion, so that I can monitor progress and debug failures.
18. As a user, I want to manage Servers globally (host, port, username, auth method, timeout, keepalive, default directory, notes), so that Pipelines reference them without duplicating config.
19. As a user, I want SSH auth to support both password and SSH key, with credentials stored securely via Windows DPAPI, so that I don't have to re-enter credentials.
20. As a user, I want a standalone dual-pane file browser (local left, remote right) for ad-hoc file management on my Servers, so that I don't need a separate tool like WinSCP.
21. As a user, I want the file browser to share the SSH connection pool with Pipeline Runs, so that connections are reused efficiently.
22. As a user, I want to organize Pipelines into folders in the sidebar, so that I can manage many Pipelines without clutter.
23. As a user, I want to search/filter Pipelines in the sidebar, so that I can find them quickly.
24. As a user, I want a VS Code-style activity bar to switch between Pipeline, File Browser, Server Management, and Settings views, so that navigation is familiar and efficient.
25. As a user, I want template references validated at save time (invalid keys, missing params, references to parallel/downstream units), so that errors are caught before execution.
26. As a user, I want renaming an ExecutionUnit or Command to auto-update all template references, so that refactoring doesn't break my Pipeline.
27. As a user, I want the DAG enforced as single-start, single-end, acyclic, and fully connected at save time, so that execution semantics are always unambiguous.
28. As a user, I want to export a Pipeline as a JSON file (without credentials) and import it elsewhere, so that I can share Pipelines with teammates.
29. As a user, I want import to prompt me to map unknown Server names to local Servers, so that imported Pipelines work in my environment.
30. As a user, I want Pipeline deletion to cascade-delete all Run history with a confirmation dialog, so that I don't leave orphaned data.
31. As a user, I want Server deletion blocked while any Pipeline references it, so that I don't break existing Pipelines.
32. As a user, I want configurable Run history retention (by days or count per Pipeline), so that storage doesn't grow unbounded.
33. As a user, I want in-app notification (status icon + title bar flash) when a Run completes, so that I notice even if I'm in another part of the app.
34. As a user, I want optional Windows toast notifications on Run completion, so that I'm alerted even when the app is in the background.
35. As a user, I want the same Pipeline blocked from concurrent Runs, so that parallel executions don't conflict on shared remote resources.
36. As a user, I want different Pipelines to run concurrently, so that independent work isn't serialized.
37. As a user, I want Transfer Commands to support glob patterns and recursive directory transfer, so that I can move multiple files in one step.
38. As a user, I want Transfer Command overwrite behavior configurable (overwrite, skip, error), so that I control what happens when destination files exist.
39. As a user, I want Transfer Commands to show bytes transferred and percentage in real-time, so that I know progress on large files.
40. As a user, I want the app in Chinese by default with English supported, so that it matches my language preference.
41. As a user, I want parallel branches to continue running when a sibling fails, so that I get complete output for debugging.
42. As a user, I want join nodes skipped when any predecessor branch failed, so that downstream steps don't run on incomplete state.
43. As a user, I want the connection pool idle timeout and max connections configurable in Settings, so that I can tune for my network environment.

## Implementation Decisions

### Architecture

- **Electron main process**: Pipeline Engine, SSH/SFTP layer, Data layer, credential storage
- **Electron renderer process**: All UI (React + Zustand state management)
- **IPC bridge**: Main ↔ Renderer communication for Run streaming, Server operations, file browser

### Module Breakdown

**1. Pipeline Engine（主进程）**
- DAG 调度器：拓扑排序确定执行顺序，fork 节点触发并行分发，join 节点等待所有前驱完成
- Command 执行器：Shell 类型通过 Shell Session 执行脚本；Transfer 类型通过 SFTP Channel 传输文件
- Context 管理器：收集 Named Outputs（解析 stdout 中的 `::set-output` 语法），存入 Context，为下游 Command 解析 `{{}}` 模板
- Shell Session 管理器：按名称创建/复用 Session，绑定到 Run 生命周期，Run 结束时销毁所有 Session
- Run 生命周期：启动（快照 Pipeline 定义 + 填充 Parameters）、执行、取消（SIGINT → 3s → force kill）、Resume（从失败 Command 继续，恢复 Context）

**2. SSH/SFTP 层（主进程）**
- 连接池：按 Server 维护连接，空闲超时回收（默认 5 分钟），最大连接数限制（默认 10）
- Shell Channel：为 Shell Session 提供交互式 shell，支持 stdout/stderr 流式输出
- SFTP Channel：文件上传/下载，支持 glob 展开、递归目录、进度回调
- 凭据存储：通过 keytar 库使用 Windows DPAPI 加密存储密码和 SSH key passphrase

**3. 数据层（主进程）**
- SQLite schema：Pipeline（含 DAG 边定义）、ExecutionUnit、Command、Server、Run（含 Pipeline 快照）、Context 快照、Run 历史
- JSON 导出/导入：Pipeline 完整序列化（不含凭据），导入时 Server 名称映射
- 保留策略：按天数或按数量清理历史 Run 记录
- Pipeline 文件夹：支持层级分组

**4. Pipeline 编辑器 UI（渲染进程）**
- DAG 流程图：@xyflow/react 实现，节点拖拽、边连接、自动布局
- DAG 验证：保存时检查单入单出、无环、全连通
- 节点详情面板：右侧面板展示 Command 列表，点击展开 Monaco 编辑器和配置表单
- 模板自动补全：Monaco language service 提供 `{{}}` 内的 Named Output 和 Parameter 补全
- 模板验证：保存时静态检查所有引用的合法性
- 重命名重构：Unit/Command 重命名时自动更新所有模板引用

**5. Run 查看器 UI（渲染进程）**
- 实时流式输出：通过 IPC 从主进程接收 stdout/stderr 流
- 按 Command 折叠回顾：完成后可展开/折叠每个 Command 的输出
- Run 历史列表：按 Pipeline 分组，显示状态、时间、耗时
- 快照查看器：查看历史 Run 时展示当时的 Pipeline 定义
- Re-run / Resume 控件：Re-run 预填参数，Resume 仅对 failed Run 可用

**6. 文件浏览器 UI（渲染进程）**
- 双面板布局：左侧本地文件系统，右侧远程 Server 文件系统
- 文件操作：上传、下载、删除、重命名、新建目录
- 进度显示：大文件传输显示进度条
- Server 选择：顶部下拉选择目标 Server（复用全局 Server 池）

**7. Server 管理 UI（渲染进程）**
- Server CRUD：表单编辑所有字段（display name, host, port, username, auth, timeout, keepalive, default dir, notes）
- 连接测试：一键测试 SSH 连接是否可达
- 删除保护：被 Pipeline 引用时禁止删除，提示哪些 Pipeline 在使用

**8. App Shell（渲染进程）**
- Activity Bar：左侧图标栏切换 Pipeline / File Browser / Server / Settings 视图
- Settings 面板：连接池配置、通知开关、Run 保留策略、语言切换
- i18n：react-i18next，中文默认，英文可选
- 通知：应用内状态提示 + 可选 Windows toast

### Key Technical Decisions

- **Execution model**: DAG 拓扑排序驱动，fork 节点的所有后继并行启动，join 节点等待所有前驱完成后才执行
- **Parallel failure**: 兄弟分支继续执行完毕，join 节点被跳过（Commands 状态为 `skipped`）
- **Shell Session 复用**: 按名称引用，Pipeline 级别定义名称，Run 级别实例化。Resume 时若 Session 创建者被跳过，自动创建新 Session 并记录警告
- **Template 解析**: 两阶段——保存时静态验证引用合法性，运行时实际替换值
- **Named Output 冲突**: 并行 Unit 声明相同 key 是保存时验证错误；同一 Command 多次写同一 key 则 last-write-wins
- **Run 快照**: 每次 Run 启动时完整快照 Pipeline 定义（JSON），存入 Run 记录
- **连接池**: 全局单例，按 Server (host:port:username) 为 key 管理连接，Pipeline Run 和文件浏览器共享
- **Transfer Command**: 不使用 Shell Session，直接从连接池获取 SFTP channel；支持 glob/递归/进度
- **本地 Shell**: 默认 PowerShell 5.1 (`powershell.exe`)，可选 cmd，按 Command 配置
- **并发控制**: 同一 Pipeline 不允许并发 Run，不同 Pipeline 可并发

### Data Model (SQLite)

核心表：
- `pipelines` — id, name, folder_id, dag_edges (JSON), parameters (JSON), created_at, updated_at
- `execution_units` — id, pipeline_id, name, position (JSON for graph coordinates)
- `commands` — id, unit_id, order, type (shell|transfer), config (JSON: script, server_id, session_name, reuse_session, on_failure, timeout, shell_type, transfer_direction, source, destination, overwrite_mode)
- `servers` — id, display_name, host, port, username, auth_method, key_path, connection_timeout, keepalive_interval, default_directory, notes
- `runs` — id, pipeline_id, status, started_at, finished_at, pipeline_snapshot (JSON), context_snapshot (JSON), resumed_from_run_id
- `command_results` — id, run_id, command_id, status, stdout, stderr, started_at, finished_at, named_outputs (JSON)
- `folders` — id, name, parent_folder_id

凭据（密码、key passphrase）不存 SQLite，通过 keytar 存入 Windows Credential Manager。

## Testing Decisions

### 测试原则

- 只测试模块的外部行为（公开接口），不测试内部实现细节
- 测试应该在模块接口变化时才需要修改，内部重构不应破坏测试
- 使用真实依赖优于 mock（SQLite 用内存数据库，SSH 用本地 SSH server 或 mock server）

### 需要测试的模块

**Pipeline Engine（单元测试 + 集成测试）**
- DAG 调度器：拓扑排序正确性、并行分发、fork/join 语义、环检测
- Context 管理器：Named Output 解析、模板替换、并行 Unit 隔离、last-write-wins
- Run 生命周期：正常完成、Command 失败 + on_failure 策略、取消、Resume（Context 恢复、Session 警告）
- Shell Session 管理器：创建、命名复用、Run 结束销毁、Resume 时自动创建

**SSH/SFTP 层（集成测试）**
- 连接池：连接创建/复用、空闲超时回收、最大连接数限制、并发安全
- Shell Channel：命令执行、stdout/stderr 流、SIGINT 发送、超时处理
- SFTP Channel：上传/下载单文件、glob 展开、递归目录、进度回调、overwrite/skip/error 行为

**数据层（单元测试）**
- SQLite CRUD：Pipeline/Unit/Command/Server/Run 的增删改查
- JSON 导出/导入：完整序列化往返（export → import → export 应一致）、Server 名称映射、重名 Pipeline 处理
- Run 快照：快照完整性、历史查看返回快照而非当前定义
- 保留策略：按天数清理、按数量清理

### 测试框架

- Vitest（与 Vite + React 生态一致）
- 主进程测试：直接 Node.js 环境运行
- SSH 集成测试：使用 dockerized SSH server 或 ssh2 mock server

## Out of Scope

- **定时触发 / 计划任务**：已明确延期，当前仅支持手动触发
- **多用户 / 权限管理**：单用户桌面应用，无需认证和权限体系
- **跳板机 (ProxyJump)**：Server 配置暂不支持，后续可扩展
- **Pipeline 版本管理**：无显式 v1/v2 版本号，Run 快照提供隐式历史
- **插件 / 扩展系统**：Command 类型封闭（Shell + Transfer），不支持自定义类型
- **Web 端 / 远程访问**：纯桌面应用，无 Web UI
- **自动更新**：首版不含 auto-update 机制
- **PowerShell 7 (pwsh)**：仅支持系统自带的 PowerShell 5.1 和 cmd

## Further Notes

- 所有领域术语以 CONTEXT.md 为准（Pipeline, ExecutionUnit, Command, Server, Context, Named Output, Parameter, Run, Shell Session）
- 架构决策记录在 docs/adr/ 目录，当前有 7 份 ADR
- 默认语言为中文，UI 文案需通过 react-i18next 管理
- 设计风格：dark-theme-first，使用 shadcn/ui + Tailwind CSS
- 首版目标：完成所有核心功能的可用版本，优先保证 Pipeline 编辑和执行的完整流程
