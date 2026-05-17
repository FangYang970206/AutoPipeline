# Named Output as Inter-Step Communication Mechanism

We use Named Outputs written into a per-Run Context (addressed via `{{unitName.commandName.key}}` template syntax) as the sole mechanism for sharing data between Commands and ExecutionUnits. We considered environment variables (less visible, hard to trace in UI) and a global mutable JSON context (too loose, no clear ownership). Named Outputs make data flow explicit and enable UI-level autocomplete and dependency visualization.
