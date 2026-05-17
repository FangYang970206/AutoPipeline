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
import type { PipelineGraph, PipelineRecord } from '../types';

type UnitNode = Node<{ label: string }>;
type UnitEdge = Edge;

export function DagEditor({ pipeline }: { pipeline: PipelineRecord }) {
  const api = window.autoPipeline?.pipelines;
  const [nodes, setNodes, onNodesChange] = useNodesState<UnitNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<UnitEdge>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!api) {
      return;
    }
    void api.getGraph(pipeline.id).then((graph) => {
      setNodes(graph.units.map((unit) => ({ id: unit.id, position: unit.position, data: { label: unit.name } })));
      setEdges(graph.edges.map((edge, index) => ({ id: `${edge.source}-${edge.target}-${index}`, source: edge.source, target: edge.target })));
    });
  }, [api, pipeline.id, setEdges, setNodes]);

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

  return (
    <section className="min-h-[560px] min-w-0 rounded-md border border-border bg-slate-950">
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
          onSelectionChange={({ nodes: selected }) => setSelectedNodeIds(selected.map((node: Node) => node.id))}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <p aria-live="polite" className="min-h-8 border-t border-border px-3 py-2 text-sm text-slate-300">
        {message}
      </p>
    </section>
  );
}
