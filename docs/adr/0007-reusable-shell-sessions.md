# Reusable Shell Sessions Across ExecutionUnits

Commands may reuse a Shell Session created by a Command in a previous ExecutionUnit within the same Run. This preserves working directory, environment, and user-switching state such as `sudo`/`su` when the Pipeline author intentionally wants continuity. We considered opening an isolated shell/channel per Command, which is simpler and safer by default, but it prevents workflows that depend on staying in the same user or shell context after an earlier Command.
