import { describe, expect, it } from 'vitest';
import { validateDag } from './dagValidation';

describe('validateDag', () => {
  it('accepts a connected acyclic DAG with one start and one end', () => {
    expect(
      validateDag({
        nodes: ['extract', 'build', 'deploy'],
        edges: [
          { source: 'extract', target: 'build' },
          { source: 'build', target: 'deploy' },
        ],
      }),
    ).toEqual({ ok: true });
  });

  it('rejects multiple start nodes', () => {
    const result = validateDag({
      nodes: ['a', 'b', 'c'],
      edges: [{ source: 'a', target: 'c' }],
    });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) {
      expect(result.errors).toContain('DAG must have exactly one start node');
    }
  });

  it('rejects cycles and disconnected graphs', () => {
    const result = validateDag({
      nodes: ['a', 'b', 'c'],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    });

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    if (!result.ok) {
      expect(result.errors).toContain('DAG must be acyclic');
      expect(result.errors).toContain('DAG must be fully connected');
    }
  });
});
