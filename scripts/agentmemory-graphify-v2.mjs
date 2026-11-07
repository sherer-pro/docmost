import { createHash } from "node:crypto";

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export async function readSnapshot(request, identity) {
  const query = new URLSearchParams(identity);
  const receipt = await request(`/agentmemory/graphify/v2/snapshot?${query}`);
  const arrays = {};
  for (const kind of ["nodes", "edges", "hyperedges"]) {
    arrays[kind] = [];
    for (let offset = 0; offset < receipt.counts[kind]; offset += 500) {
      const page = await request(
        `/agentmemory/graphify/v2/objects?${new URLSearchParams({ ...identity, generation: receipt.id, kind, offset: String(offset), limit: "500" })}`,
      );
      if (
        page.generation !== receipt.id ||
        page.offset !== offset ||
        page.total !== receipt.counts[kind] ||
        page.items.length !== Math.min(500, page.total - offset)
      ) {
        throw new Error("Invalid or changing Graphify readback page");
      }
      arrays[kind].push(...page.items);
    }
  }
  const graph = {
    ...receipt.metadata,
    nodes: arrays.nodes,
    [receipt.edgeKey]: arrays.edges,
    ...(receipt.hasHyperedges ? { hyperedges: arrays.hyperedges } : {}),
  };
  if (!receipt.complete || digest(graph) !== receipt.digest)
    throw new Error("Graphify readback digest mismatch");
  return { receipt, graph };
}

export async function importSnapshot(
  request,
  { graph, projectKey, provenance, assertIdempotent = false },
) {
  const capabilities = await request("/agentmemory/graphify/v2/capabilities");
  if (capabilities.protocolVersion !== 2 || !capabilities.completeSnapshots)
    throw new Error("Full Graphify snapshot protocol is unavailable");
  const identity = { projectKey, sourceKey: "graphify" };
  const edgeKey = Array.isArray(graph.links) ? "links" : "edges";
  if (Array.isArray(graph.links) && Array.isArray(graph.edges))
    throw new Error("Ambiguous graph edge arrays");
  const { nodes, hyperedges = [], ...metadata } = graph;
  const edges = graph[edgeKey];
  delete metadata[edgeKey];
  delete metadata.hyperedges;
  if (![nodes, edges, hyperedges].every(Array.isArray))
    throw new Error("Graph object arrays are required");
  const arrays = { nodes, edges, hyperedges };
  const input = {
    protocolVersion: 2,
    ...identity,
    digest: digest(graph),
    counts: Object.fromEntries(
      Object.entries(arrays).map(([key, value]) => [key, value.length]),
    ),
    metadata,
    edgeKey,
    hasHyperedges: Object.hasOwn(graph, "hyperedges"),
    provenance,
  };
  const begin = () =>
    request("/agentmemory/graphify/v2/imports/begin", {
      method: "POST",
      body: JSON.stringify(input),
    });
  const initial = await begin();
  if (initial.state !== "active") {
    for (const [kind, items] of Object.entries(arrays)) {
      let batch = [];
      let index = 0;
      const send = async () => {
        const payload = { kind, index, items: batch, digest: digest(batch) };
        if (
          Buffer.byteLength(JSON.stringify(payload)) >
          capabilities.limits.batchBytes
        )
          throw new Error("Graphify batch exceeds server byte limit");
        await request(
          `/agentmemory/graphify/v2/imports/${initial.id}/batches`,
          { method: "POST", body: JSON.stringify(payload) },
        );
        index += 1;
        batch = [];
      };
      for (const item of items) {
        if (
          batch.length &&
          (batch.length >= capabilities.limits.batchObjects ||
            Buffer.byteLength(JSON.stringify([...batch, item])) >
              capabilities.limits.batchBytes - 1024)
        )
          await send();
        batch.push(item);
      }
      if (batch.length) await send();
    }
    await request(`/agentmemory/graphify/v2/imports/${initial.id}/finish`, {
      method: "POST",
      body: "{}",
    });
  }
  const verified = await readSnapshot(request, identity);
  if (
    canonical(verified.graph) !== canonical(graph) ||
    canonical(verified.receipt.provenance) !== canonical(provenance)
  )
    throw new Error("Graphify attributes or provenance changed during import");
  if (assertIdempotent) {
    const repeated = await begin();
    if (repeated.id !== verified.receipt.id || repeated.state !== "active")
      throw new Error("Graphify repeated import changed generation");
  }
  return {
    ...verified.receipt,
    readbackVerified: true,
    idempotentVerified: assertIdempotent,
  };
}
