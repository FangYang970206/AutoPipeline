export interface DagEdge {
  source: string;
  target: string;
}

export interface DagDefinition {
  nodes: string[];
  edges: DagEdge[];
}

export type DagValidationResult = { ok: true } | { ok: false; errors: string[] };

export function validateDag(definition: DagDefinition): DagValidationResult {
  const nodeSet = new Set(definition.nodes);
  const incoming = new Map(definition.nodes.map((node) => [node, 0]));
  const outgoing = new Map(definition.nodes.map((node) => [node, 0]));
  const adjacency = new Map(definition.nodes.map((node) => [node, [] as string[]]));

  for (const edge of definition.edges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) {
      continue;
    }
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
    outgoing.set(edge.source, outgoing.get(edge.source)! + 1);
    adjacency.get(edge.source)!.push(edge.target);
  }

  const errors: string[] = [];
  if ([...incoming.values()].filter((count) => count === 0).length !== 1) {
    errors.push('DAG must have exactly one start node');
  }
  if ([...outgoing.values()].filter((count) => count === 0).length !== 1) {
    errors.push('DAG must have exactly one end node');
  }
  if (hasCycle(definition.nodes, adjacency)) {
    errors.push('DAG must be acyclic');
  }
  if (!isFullyConnected(definition.nodes, definition.edges)) {
    errors.push('DAG must be fully connected');
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function hasCycle(nodes: string[], adjacency: Map<string, string[]>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): boolean => {
    if (visiting.has(node)) {
      return true;
    }
    if (visited.has(node)) {
      return false;
    }

    visiting.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  return nodes.some((node) => visit(node));
}

function isFullyConnected(nodes: string[], edges: DagEdge[]) {
  if (nodes.length === 0) {
    return false;
  }

  const undirected = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const edge of edges) {
    undirected.get(edge.source)?.push(edge.target);
    undirected.get(edge.target)?.push(edge.source);
  }

  const seen = new Set<string>();
  const stack = [nodes[0]];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);
    stack.push(...(undirected.get(node) ?? []));
  }

  return seen.size === nodes.length;
}
