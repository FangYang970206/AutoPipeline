# Visual Flow Editor for Pipeline Editing

Pipeline editing uses a visual flow-graph editor (node-and-edge style, similar to n8n/Node-RED) rather than a plain list. Each ExecutionUnit is a node; edges represent execution order and data flow. This was chosen over a list-based editor because the app supports parallel ExecutionUnits, and a flow graph makes parallelism and dependencies visually obvious. The trade-off is higher implementation complexity (requires @xyflow/react or similar), but the user explicitly prioritized polished UI.

## Considered Options

- **List-based editor** — simpler to build, but parallel units are hard to represent visually
- **List + minimap** — compromise, but still doesn't show parallelism clearly
