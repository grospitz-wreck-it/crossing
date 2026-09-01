export type GeoPoint = { lat: number; lon: number };

export type RailWayRow = {
  osmId: string;
  nodeIds: string[];
  geometry: GeoPoint[];
  ref?: string;
};

type Edge = { to: string; distance: number; wayId: string };

export type RailGraph = {
  nodePoints: Map<string, GeoPoint>;
  adjacency: Map<string, Edge[]>;
  wayIds: Set<string>;
};

const METERS_PER_DEGREE = 111320;

export function distanceMeters(a: GeoPoint, b: GeoPoint) {
  const latScale = Math.cos((a.lat * Math.PI) / 180);
  const dx = (a.lon - b.lon) * METERS_PER_DEGREE * latScale;
  const dy = (a.lat - b.lat) * METERS_PER_DEGREE;
  return Math.hypot(dx, dy);
}

export function buildRailGraph(rows: RailWayRow[]): RailGraph {
  const nodePoints = new Map<string, GeoPoint>();
  const adjacency = new Map<string, Edge[]>();
  const wayIds = new Set<string>();

  const addEdge = (from: string, to: string, distance: number, wayId: string) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push({ to, distance, wayId });
  };

  for (const way of rows) {
    if (way.nodeIds.length < 2 || way.geometry.length < 2) continue;
    wayIds.add(way.osmId);
    const count = Math.min(way.nodeIds.length, way.geometry.length);
    for (let i = 0; i < count; i += 1) nodePoints.set(way.nodeIds[i], way.geometry[i]);
    for (let i = 1; i < count; i += 1) {
      const from = way.nodeIds[i - 1];
      const to = way.nodeIds[i];
      const distance = distanceMeters(way.geometry[i - 1], way.geometry[i]);
      addEdge(from, to, distance, way.osmId);
      addEdge(to, from, distance, way.osmId);
    }
  }

  return { nodePoints, adjacency, wayIds };
}

export function nearestNode(graph: RailGraph, point: GeoPoint, maxDistanceMeters = 5000) {
  let best: { nodeId: string; distance: number } | null = null;
  for (const [nodeId, nodePoint] of graph.nodePoints) {
    const distance = distanceMeters(point, nodePoint);
    if (distance > maxDistanceMeters) continue;
    if (!best || distance < best.distance) best = { nodeId, distance };
  }
  return best;
}

type HeapEntry = { node: string; distance: number };

function pushHeap(heap: HeapEntry[], entry: HeapEntry) {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].distance <= heap[index].distance) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function popHeap(heap: HeapEntry[]): HeapEntry | undefined {
  if (!heap.length) return undefined;
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && heap[left].distance < heap[smallest].distance) smallest = left;
      if (right < heap.length && heap[right].distance < heap[smallest].distance) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
      index = smallest;
    }
  }
  return first;
}

export function shortestRailPath(graph: RailGraph, start: string, target: string, maxVisited = 50000) {
  if (start === target) return { nodes: [start], wayIds: new Set<string>(), distance: 0 };

  const distances = new Map<string, number>([[start, 0]]);
  const previous = new Map<string, { node: string; wayId: string }>();
  const queue: HeapEntry[] = [{ node: start, distance: 0 }];
  const visited = new Set<string>();

  while (queue.length) {
    const current = popHeap(queue)!;
    if (visited.has(current.node)) continue;
    visited.add(current.node);
    if (visited.size > maxVisited) break;
    if (current.node === target) break;

    for (const edge of graph.adjacency.get(current.node) ?? []) {
      if (visited.has(edge.to)) continue;
      const nextDistance = current.distance + edge.distance;
      if (nextDistance >= (distances.get(edge.to) ?? Infinity)) continue;
      distances.set(edge.to, nextDistance);
      previous.set(edge.to, { node: current.node, wayId: edge.wayId });
      pushHeap(queue, { node: edge.to, distance: nextDistance });
    }
  }

  if (!distances.has(target)) return null;

  const nodes: string[] = [];
  const wayIds = new Set<string>();
  let cursor = target;
  nodes.push(cursor);
  while (cursor !== start) {
    const step = previous.get(cursor);
    if (!step) return null;
    wayIds.add(step.wayId);
    cursor = step.node;
    nodes.push(cursor);
  }
  nodes.reverse();
  return { nodes, wayIds, distance: distances.get(target)! };
}
