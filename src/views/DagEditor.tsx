import dagre from 'dagre';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  type Edge,
  type Node,
  type OnConnect,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import { Button } from '../components/ui/button';
import { validateDag } from '../main/dag/dagValidation';
import type {
  CommandExecutionStatus,
  ExecutionEvent,
  PipelineGraph,
  PipelineParameter,
  PipelineRecord,
  RunStatus,
} from '../types';
import { CommandPanel } from './CommandPanel';

type UnitNode = Node<{ label: string }>;
type UnitEdge = Edge;
type CommandOutput = { status: CommandExecutionStatus; stdout: string; stderr: string };

export function DagEditor({ pipeline }: { pipeline: PipelineRecord }) {
  const api = window.autoPipeline?.pipelines;
  const runsApi = window.autoPipeline?.runs;
  const [nodes, setNodes, onNodesChange] = useNodesState<UnitNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<UnitEdge>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedUnit, setSelectedUnit] = useState<{ id: string; name: string } | null>(null);
  const [message, setMessage] = useState('');
  const [parameters, setParameters] = useState<PipelineParameter[]>(pipeline.parameters ?? []);
  const [shellSessions, setShellSessions] = useState<string[]>(pipeline.shellSessions ?? []);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [commandOutputs, setCommandOutputs] = useState<Record<string, CommandOutput>>({});

  useEffect(() => {
    setParameters(pipeline.parameters ?? []);
    setShellSessions(pipeline.shellSessions ?? []);
  }, [pipeline.id, pipeline.parameters, pipeline.shellSessions]);

  useEffect(() => {
    if (!api) {
      return;
    }
    void api.getGraph(pipeline.id).then((graph) => {
      setNodes(graph.units.map((unit) => ({ id: unit.id, position: unit.position, data: { label: unit.name } })));
      setEdges(graph.edges.map((edge, index) => ({ id: `${edge.source}-${edge.target}-${index}`, source: edge.source, target: edge.target })));
    });
  }, [api, pipeline.id, setEdges, setNodes]);

  useEffect(() => {
    if (!runsApi) {
      return undefined;
    }
    return runsApi.onEvent((event) => handleExecutionEvent(event));
  }, [runsApi]);

  const onConnect = useCallback<OnConnect>((connection) => setEdges((current) => addEdge(connection, current)), [setEdges]);

  const graph = useMemo<PipelineGraph>(
    () => ({
      units: nodes.map((node) => ({
        id: node.id,
        name: String(node.data.label),
        position: node.position,
      })),
      edges: edges.map((edge) => ({ source: edge.source, target: edge.target })),
    }),
    [edges, nodes],
  );

  function addNode() {
    const next = nodes.length + 1;
    setNodes((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        position: { x: 80 + next * 40, y: 80 + next * 20 },
        data: { label: `ExecutionUnit ${next}` },
      },
    ]);
  }

  function deleteSelected() {
    setNodes((current) => current.filter((node) => !selectedNodeIds.includes(node.id)));
    setEdges((current) => current.filter((edge) => !selectedNodeIds.includes(edge.source) && !selectedNodeIds.includes(edge.target)));
  }

  function autoLayout() {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: 'LR' });
    for (const node of nodes) {
      g.setNode(node.id, { width: 180, height: 48 });
    }
    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }
    dagre.layout(g);
    setNodes((current) =>
      current.map((node) => {
        const layout = g.node(node.id);
        return layout ? { ...node, position: { x: layout.x, y: layout.y } } : node;
      }),
    );
  }

  async function save() {
    if (!api) {
      setMessage('IPC bridge unavailable');
      return;
    }
    const result = validateDag({ nodes: graph.units.map((unit) => unit.id), edges: graph.edges });
    if (!result.ok) {
      setMessage(result.errors.join('; '));
      return;
    }
    await api.saveGraph(pipeline.id, graph);
    setMessage('DAG 已保存');
  }

  async function runPipeline() {
    if (!runsApi) {
      setMessage('IPC bridge unavailable');
      return;
    }
    setActiveRunId(null);
    setRunStatus('pending');
    setCommandOutputs({});
    setMessage('Pipeline 运行中');
    try {
      const run = await runsApi.start(pipeline.id, collectParameterValues(parameters));
      setActiveRunId(run.id);
      setRunStatus(run.status);
      setMessage(run.status === 'succeeded' ? 'Pipeline 运行成功' : 'Pipeline 运行失败');
    } catch (error) {
      setRunStatus('failed');
      setMessage(error instanceof Error ? error.message : 'Pipeline 运行失败');
    }
  }

  async function saveParameters() {
    if (!api) {
      setMessage('IPC bridge unavailable');
      return;
    }
    const updated = await api.updateParameters(pipeline.id, parameters);
    setParameters(updated.parameters);
    setMessage('参数已保存');
  }

  async function saveShellSessions() {
    if (!api) {
      setMessage('IPC bridge unavailable');
      return;
    }
    const updated = await api.updateShellSessions(pipeline.id, shellSessions);
    setShellSessions(updated.shellSessions);
    setMessage('Shell sessions saved');
  }

  function handleExecutionEvent(event: ExecutionEvent) {
    if (event.type === 'run-status') {
      setActiveRunId(event.runId);
      setRunStatus(event.status);
      return;
    }

    setCommandOutputs((current) => {
      const previous = current[event.commandId] ?? { status: 'pending', stdout: '', stderr: '' };
      if (event.type === 'command-status') {
        return { ...current, [event.commandId]: { ...previous, status: event.status } };
      }
      return {
        ...current,
        [event.commandId]: {
          ...previous,
          [event.type]: previous[event.type] + event.data,
        },
      };
    });
  }

  return (
    <section className="flex min-h-[620px] min-w-0 overflow-hidden rounded-md border border-border bg-slate-950">
      <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <h2 className="text-lg font-semibold">{pipeline.name}</h2>
          <p className="text-xs text-slate-400">ExecutionUnit DAG</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={addNode} type="button" variant="ghost">
            添加节点
          </Button>
          <Button disabled={selectedNodeIds.length === 0} onClick={deleteSelected} type="button" variant="ghost">
            删除节点
          </Button>
          <Button onClick={autoLayout} type="button" variant="ghost">
            自动布局
          </Button>
          <Button disabled={runStatus === 'running'} onClick={() => void runPipeline()} type="button" variant="ghost">
            运行 Pipeline
          </Button>
          <Button onClick={() => void save()} type="button">
            保存 DAG
          </Button>
        </div>
      </div>
      <div className="h-[460px]">
        <ReactFlow
          edges={edges}
          fitView
          nodes={nodes}
          onConnect={onConnect}
          onEdgesChange={onEdgesChange}
          onNodesChange={onNodesChange}
          onNodeClick={(_event, node) => setSelectedUnit({ id: node.id, name: String(node.data.label) })}
          onSelectionChange={({ nodes: selected }) => setSelectedNodeIds(selected.map((node: Node) => node.id))}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <p aria-live="polite" className="min-h-8 border-t border-border px-3 py-2 text-sm text-slate-300">
        {message}
      </p>
      <ParameterEditor parameters={parameters} onChange={setParameters} onSave={() => void saveParameters()} />
      <ShellSessionEditor shellSessions={shellSessions} onChange={setShellSessions} onSave={() => void saveShellSessions()} />
      <RunViewer commandOutputs={commandOutputs} runId={activeRunId} status={runStatus} />
      </div>
      {selectedUnit ? <CommandPanel shellSessions={shellSessions} unitId={selectedUnit.id} unitName={selectedUnit.name} /> : null}
    </section>
  );
}

function ShellSessionEditor({
  onChange,
  onSave,
  shellSessions,
}: {
  onChange: (shellSessions: string[]) => void;
  onSave: () => void;
  shellSessions: string[];
}) {
  function update(index: number, value: string) {
    onChange(shellSessions.map((session, currentIndex) => (currentIndex === index ? value : session)));
  }

  return (
    <div className="border-t border-border bg-slate-900 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">Shell Sessions</h3>
        <div className="flex gap-2">
          <Button onClick={() => onChange([...shellSessions, `session-${shellSessions.length + 1}`])} type="button" variant="ghost">
            Add Session
          </Button>
          <Button onClick={onSave} type="button" variant="ghost">
            Save Sessions
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {shellSessions.map((session, index) => (
          <div className="grid grid-cols-[1fr_auto] gap-2" key={`${session}-${index}`}>
            <input className={inputClass} value={session} onChange={(event) => update(index, event.target.value)} />
            <Button onClick={() => onChange(shellSessions.filter((_, currentIndex) => currentIndex !== index))} type="button" variant="ghost">
              Delete
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ParameterEditor({
  onChange,
  onSave,
  parameters,
}: {
  onChange: (parameters: PipelineParameter[]) => void;
  onSave: () => void;
  parameters: PipelineParameter[];
}) {
  function update(index: number, patch: Partial<PipelineParameter>) {
    onChange(parameters.map((parameter, currentIndex) => (currentIndex === index ? { ...parameter, ...patch } : parameter)));
  }

  return (
    <div className="border-t border-border bg-slate-900 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">参数</h3>
        <div className="flex gap-2">
          <Button
            onClick={() => onChange([...parameters, { name: `param${parameters.length + 1}`, type: 'string', defaultValue: '' }])}
            type="button"
            variant="ghost"
          >
            添加参数
          </Button>
          <Button onClick={onSave} type="button" variant="ghost">
            保存参数
          </Button>
        </div>
      </div>
      <div className="grid gap-2">
        {parameters.map((parameter, index) => (
          <div className="grid grid-cols-[1fr_110px_1fr_1fr_auto] gap-2" key={`${parameter.name}-${index}`}>
            <input className={inputClass} value={parameter.name} onChange={(event) => update(index, { name: event.target.value })} />
            <select
              className={inputClass}
              value={parameter.type}
              onChange={(event) => update(index, { type: event.target.value as PipelineParameter['type'] })}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="select">select</option>
            </select>
            <input
              className={inputClass}
              value={String(parameter.defaultValue)}
              onChange={(event) => update(index, { defaultValue: coerceParameterValue(parameter.type, event.target.value) })}
            />
            <input
              className={inputClass}
              value={parameter.options?.join(',') ?? ''}
              onChange={(event) => update(index, { options: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })}
            />
            <Button onClick={() => onChange(parameters.filter((_, currentIndex) => currentIndex !== index))} type="button" variant="ghost">
              删除
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RunViewer({
  commandOutputs,
  runId,
  status,
}: {
  commandOutputs: Record<string, CommandOutput>;
  runId: number | null;
  status: RunStatus | null;
}) {
  const entries = Object.entries(commandOutputs);
  if (!status && entries.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-border bg-slate-900 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">运行输出</h3>
        <span className="text-xs text-slate-400">
          {runId ? `Run #${runId}` : '等待启动'} · {status ?? 'pending'}
        </span>
      </div>
      <div className="max-h-56 space-y-2 overflow-auto">
        {entries.map(([commandId, output]) => (
          <details className="rounded-md border border-border bg-slate-950" key={commandId} open={output.status === 'running'}>
            <summary className="cursor-pointer px-3 py-2 text-sm text-slate-200">
              {commandId} · {output.status}
            </summary>
            <pre className="whitespace-pre-wrap border-t border-border px-3 py-2 text-xs text-slate-200">
              {output.stdout}
              {output.stderr ? `\n[stderr]\n${output.stderr}` : ''}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}

function collectParameterValues(parameters: PipelineParameter[]) {
  return Object.fromEntries(
    parameters.map((parameter) => {
      if (parameter.type === 'boolean') {
        return [parameter.name, window.confirm(`${parameter.name}?`)];
      }
      const value = window.prompt(parameter.name, String(parameter.defaultValue));
      return [parameter.name, coerceParameterValue(parameter.type, value ?? parameter.defaultValue)];
    }),
  );
}

function coerceParameterValue(type: PipelineParameter['type'], value: string | number | boolean) {
  if (type === 'number') {
    return Number(value);
  }
  if (type === 'boolean') {
    return value === true || value === 'true';
  }
  return String(value);
}

const inputClass =
  'h-9 rounded-md border border-border bg-slate-950 px-3 text-sm text-white outline-none focus:border-accent';
