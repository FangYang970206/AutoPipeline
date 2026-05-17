# AutoPipeline

A Windows desktop application for defining and executing multi-step automation pipelines with built-in remote server management.

## Language

**Pipeline**:
A named, reusable automation workflow composed of ordered ExecutionUnits.
_Avoid_: workflow, job, task

**ExecutionUnit**:
A named step within a Pipeline, composed of one or more Commands. Units execute sequentially by default but can be configured to run in parallel with other Units.
_Avoid_: step, stage, task

**Command**:
A single runnable step within an ExecutionUnit. Two types exist: **Shell** (runs a script on local or remote target) and **Transfer** (uploads or downloads files via SFTP). Commands within a Unit execute strictly sequentially.
_Avoid_: script, action, step

**Server**:
A globally-configured remote SSH connection target. Fields: display name, host, port (default 22), username, auth method (password or SSH key), password or key path, connection timeout, keepalive interval, default working directory, description/notes. Referenced by Pipelines and Commands; not owned by any single Pipeline.
_Avoid_: host, machine, node, remote

**Context**:
The shared key-value store for a single Pipeline run. Each Command can declare Named Outputs that are written into the Context and referenced by downstream Commands or Units via `{{unitName.commandName.key}}` template syntax.
_Avoid_: environment, variables, state

**Named Output**:
A string key-value pair declared by a Command as its result. Written into the Pipeline's Context and addressable by downstream Commands.
_Avoid_: output variable, export, return value

**Parameter**:
A named input variable defined on a Pipeline, with a type and optional default value. Supported types: `string`, `number`, `boolean`, `select` (predefined options). Filled by the user at trigger time and referenced in Command scripts via `{{params.name}}`.
_Avoid_: variable, input, argument

**Run**:
A single execution instance of a Pipeline. Captures start time, status, the full output of every Command, and a snapshot of the Pipeline definition at trigger time. Possible statuses: `running`, `success`, `failed`, `cancelled`.
_Avoid_: execution, job run, invocation

**Shell Session**:
A per-Run command environment for one local or remote target that may be reused by later Commands to preserve working directory, user identity, and shell state. Each session has a unique name within its Pipeline, assigned by the Command that creates it. Later Commands reference that name to reuse the session.
_Avoid_: terminal, channel, connection

## Relationships

- A **Pipeline** contains one or more **ExecutionUnits** (ordered)
- An **ExecutionUnit** contains one or more **Commands** (strictly sequential)
- **ExecutionUnits** within a **Pipeline** are sequential by default; parallel execution is configurable per-Unit
- A **Command** targets either the local machine or one **Server**
- A **Shell Command** runs inside exactly one **Shell Session**
- A **Transfer Command** uses an SFTP channel from the connection pool directly (no Shell Session)
- A **Transfer Command** may declare **Named Outputs** (e.g. resolved remote path, bytes transferred)
- Template syntax `{{}}` works in **Transfer Command** source/destination paths
- A **Shell Session** belongs to exactly one **Run** and one local or remote target
- A **Shell Session** has a unique name within its **Pipeline** definition
- A **Command** either creates a new named **Shell Session** or reuses an existing one by name
- A **Command** may reuse a **Shell Session** created by a Command in a previous **ExecutionUnit**
- A **Command** may declare zero or more **Named Outputs**
- A **Pipeline Run** has exactly one **Context** shared across all Units and Commands
- A **Pipeline** may define zero or more **Parameters** (filled at trigger time)
- A **Command** may reference **Parameters** via `{{params.name}}` in its script
- **Parameters** are immutable during a **Run**
- Template references to **Named Outputs** must point to upstream **Commands**
- Parallel **ExecutionUnits** cannot read each other's **Named Outputs** (execution order is undefined)
- If two parallel **ExecutionUnits** declare the same **Named Output** key, it is a validation error at save time
- A downstream **ExecutionUnit** may only reference **Named Outputs** from units guaranteed to have completed before it starts

## Example dialogue

> **Dev:** "When a Command on Server A finishes, can the next Command on Server B use its output?"
> **Domain expert:** "Yes — the first Command declares a Named Output, which gets written to the Run's Context. The second Command references it via `{{unit1.cmd1.key}}` in its script template."

> **Dev:** "If I need to run as a different Unix user mid-pipeline, do I reconnect?"
> **Domain expert:** "No — a Command can switch user inside a Shell Session, and later Commands can reuse that Shell Session when they need the same user context."

## UI & UX

- Two-panel layout: left sidebar (activity bar + panel content) | right main area (Edit mode / Run mode toggled via top tabs)
- Left activity bar (VS Code style icon strip): Pipeline, File Browser, Server Management, Settings
- Clicking an activity bar icon switches the sidebar panel content
- Pipeline list supports user-created folders for grouping (e.g. by project, environment)
- Pipeline list supports search/filter within the sidebar
- Pipeline editor: visual flow-graph (node-and-edge DAG, @xyflow/react), each ExecutionUnit is a node
- Parallelism is expressed by graph topology: fork (one node → multiple outgoing edges) and join (multiple nodes → one node) encode parallel execution
- The graph shape is the execution plan — no separate parallel flags or group containers
- DAG must have exactly one start node (no predecessors) and one end node (no successors)
- DAG must be acyclic, fully connected, with no isolated nodes
- DAG validation is enforced at save time
- When a parallel branch fails, sibling branches continue to completion (no cross-branch cancellation)
- A join node (downstream of parallel branches) is skipped if any predecessor branch failed; its Commands get status `skipped`
- Component library: shadcn/ui + Tailwind CSS (modern, dark-theme-first)
- Internationalization: react-i18next, default Chinese, English supported
- Code editor: Monaco Editor (Shell syntax highlighting + `{{}}` template autocomplete)
- Clicking an ExecutionUnit node opens a detail panel on the right side; the flow graph remains visible
- Detail panel shows the Unit's Command list; clicking a Command expands its Monaco editor and configuration form
- Template references are validated at save time: invalid Named Output keys, missing Parameters, and references to parallel/downstream units are errors that block save
- Renaming an ExecutionUnit or Command auto-updates all template references in the Pipeline editor
- Template resolution still occurs at run time, but save-time validation guarantees correctness under normal operation
- State management: Zustand
- Run output: real-time streaming during execution, collapsible per-Command review after completion
- Re-run: supported — creates a new Run using the current Pipeline definition, pre-fills last Parameter values
- Resume from failure: supported — continues from the failed Command using the current Pipeline definition
- Resume restores Named Outputs from the failed Run's recorded Context into the new Run's Context
- Resume skips already-succeeded Commands; starts at the failed Command within its ExecutionUnit
- Resume generates a new Run record linked to the original failed Run ID
- If a resumed Command references a Shell Session whose creator was skipped, a new Session is auto-created to the same Server with a warning logged ("Session state not restored")
- Resume is only available on Runs with status `failed` (not `cancelled` or `success`)
- Run history: configurable retention (by days or count per Pipeline)
- Each Run snapshots the full Pipeline definition at trigger time (Units, Commands, scripts, parameters)
- Viewing a historical Run shows the snapshotted definition, not the current Pipeline state
- No explicit Pipeline versioning (no v1/v2) — snapshots in Runs provide implicit history
- Pipeline editing is direct overwrite, no drafts or branches
- File transfer: both as Pipeline Command type AND standalone file browser (WinSCP-like)
- Standalone file browser is a top-level navigation item in the left sidebar (peer to Pipelines)
- File browser uses the same global Server pool — no duplicate server configuration
- File browser is dual-pane: local filesystem on the left, remote on the right
- File browser shares the SSH connection pool with pipeline Runs (SFTP channels multiplexed over same connection)
- Pipeline Parameters: defined per-Pipeline, prompted at trigger time via dialog
- Parameter types: `string` (text input), `number` (numeric input with validation), `boolean` (toggle/checkbox), `select` (dropdown with predefined options)
- All Parameter values are interpolated as strings in `{{params.name}}` templates regardless of type
- Command scripts use Shell only (bash/sh for remote, PowerShell/cmd for local)
- Local Shell Command shell type is configurable per-Command: `powershell | cmd`, default `powershell`
- `powershell` means Windows PowerShell 5.1 (`powershell.exe`, system built-in)
- Command types are closed: Shell and Transfer only. HTTP calls, waits, etc. are expressed as Shell Commands.
- Transfer Command is one direction per Command: `upload` or `download`
- Transfer Command source path supports single file, glob pattern (e.g. `*.log`), or directory (recursive)
- Transfer Command overwrite behavior is configurable per-Command: `overwrite | skip | error`, default `overwrite`
- Transfer Command auto-creates destination directory if it doesn't exist
- Transfer Command shows bytes transferred and percentage in real-time Run output
- Named Outputs declared via `::set-output name=key::value` syntax in script stdout
- If a Command writes the same Named Output key multiple times, the last value wins and the Run output records the overwrite
- Command `on_failure` is configurable per-Command: `stop | continue | skip_unit`
- Per-Command timeout: optional, in seconds, default is no timeout (infinite)
- Timeout fires the same kill sequence as cancellation (SIGINT → grace → force-close), then applies the Command's `on_failure` policy
- No Pipeline-level timeout
- `skip_unit` skips the remaining Commands in the current ExecutionUnit only
- SSH auth supports both password and SSH key; credentials stored via Windows DPAPI (`keytar`)
- SSH connections managed via global connection pool with configurable idle timeout (default 5 minutes) and max connections (default 10), set in app Settings
- Shell Session reuse is configurable per-Command and scoped to one Run
- A **Run** can be cancelled by the user during execution
- Same Pipeline cannot have concurrent Runs — triggering a Pipeline that is already running is blocked with a prompt
- Different Pipelines may run concurrently
- Each Run has isolated Shell Session instances even if session names are the same across Runs
- On cancel: SIGINT is sent to the in-flight process, with a 3-second grace period before forcibly closing the channel
- All **Shell Sessions** for a cancelled **Run** are destroyed immediately
- Commands that never started during a cancelled **Run** get status `skipped`
- Run completion triggers in-app notification (sidebar status icon + title bar flash)
- Windows system notification (toast) on Run completion is optional, configurable in app settings
- Pipeline import creates a renamed copy by default when a Pipeline with the same name already exists
- Pipeline export is a single JSON file containing the full definition (Units, Commands, scripts, parameters, DAG edges)
- Export does not include Server credentials — only Server reference names
- On import, if a referenced Server name doesn't exist locally, user is prompted to map it to an existing Server or create a new one
- Server deletion is blocked while any Pipeline still references that Server
- Pipeline deletion cascades to all associated Run history records; requires user confirmation dialog

## Flagged ambiguities

- "切换用户" (user switching) — resolved: means `sudo`/`su` within an existing SSH shell session, NOT reconnecting with different SSH credentials.
- "执行单元" — resolved as **ExecutionUnit** (not "stage" or "step", which are overloaded in CI/CD contexts).
- "复用连接" — resolved: reusing an SSH connection is not the same as reusing a **Shell Session**; Commands may intentionally reuse a Shell Session to preserve user and shell state across ExecutionUnits.
