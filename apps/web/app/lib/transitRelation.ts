export type TransitStopMember = {
  ref?: string;
  name?: string;
  role: string;
  type: string;
  id: number;
};

export type TransitRelationInfo = {
  relationId: number;
  ref?: string;
  name?: string;
  railway?: string;
  stops: TransitStopMember[];
};

const TRANSIT_RAILWAYS = new Set(["tram", "light_rail", "subway", "monorail"]);

export async function loadTransitRelation(relationId: number): Promise<TransitRelationInfo | null> {
  if (!Number.isFinite(relationId) || relationId <= 0) return null;

  for (const endpoint of [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ]) {
    try {
      const query = `[out:json][timeout:20];rel(${Math.trunc(relationId)});(._;>;);out body;`;
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, {
        cache: "no-store",
        headers: { accept: "application/json", "user-agent": "Crossings/1.0 (meineschranke.com)" },
      });
      if (!response.ok) continue;

      const data = await response.json();
      const relation = (data?.elements || []).find(
        (element: any) => element.type === "relation" && Number(element.id) === Math.trunc(relationId)
      );
      if (!relation) continue;

      const elements = Array.isArray(data?.elements) ? data.elements : [];
      const nodes = new Map<number, any>(
        elements.filter((element: any) => element.type === "node").map((element: any) => [Number(element.id), element])
      );
      const ways = new Map<number, any>(
        elements.filter((element: any) => element.type === "way").map((element: any) => [Number(element.id), element])
      );

      const stops: TransitStopMember[] = [];
      for (const member of Array.isArray(relation.members) ? relation.members : []) {
        const role = String(member.role || "").toLowerCase();
        if (!/^(stop|platform|stop_entry_only|stop_exit_only)$/.test(role)) continue;

        const id = Number(member.ref);
        const element = member.type === "node" ? nodes.get(id) : ways.get(id);
        const tags = element?.tags || {};
        const railway = String(tags.railway || "").toLowerCase();
        if (railway && !TRANSIT_RAILWAYS.has(railway) && !tags.public_transport) continue;

        stops.push({
          id,
          type: String(member.type || ""),
          role,
          ref: String(tags.ref || tags.local_ref || relation.tags?.ref || "").trim() || undefined,
          name: String(tags.name || tags["name:de"] || "").trim() || undefined,
        });
      }

      return {
        relationId: Math.trunc(relationId),
        ref: String(relation.tags?.ref || "").trim() || undefined,
        name: String(relation.tags?.name || relation.tags?.description || "").trim() || undefined,
        railway: String(relation.tags?.route || relation.tags?.railway || "").trim() || undefined,
        stops,
      };
    } catch {
      // Try the secondary Overpass endpoint.
    }
  }

  return null;
}
