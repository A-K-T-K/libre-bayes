/** Kahn's algorithm: a graph is a valid DAG iff every node can be removed
 * by repeatedly stripping zero-in-degree nodes. Our own editor already
 * blocks cycle-forming edges at creation time, but an imported file (BIF,
 * NET, XDSL, DSC, JSON) can bring one in from outside, so this check runs
 * independently rather than assuming the invariant always holds. */
export function isValidDag(nodeIds: string[], edges: [string, string][]): boolean {
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const adjacency = new Map<string, string[]>(nodeIds.map((id) => [id, []]));

  for (const [from, to] of edges) {
    if (!adjacency.has(from) || !inDegree.has(to)) continue;
    adjacency.get(from)!.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const queue = nodeIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    visited += 1;
    for (const next of adjacency.get(current) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return visited === nodeIds.length;
}
