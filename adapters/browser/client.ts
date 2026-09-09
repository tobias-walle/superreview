import type { ReviewClient } from "../../lib/review/types";

async function request<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(
    `/api/${path}`,
    value === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Superreview": "1" },
          body: JSON.stringify(value),
        },
  );
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "Could not save review");
  return result;
}

export const httpClient: ReviewClient = {
  load: () => request("session"),
  execute: (command, sequence, id) => request("commands", { command, sequence, id }),
  saveDrafts: async (drafts, revision) => {
    const saved = await request<{ revision: number }>("drafts", {
      drafts,
      revision,
    });
    return saved.revision;
  },
  refresh: (view) => request("refresh", { view }),
  snapshot: (id) => request(`snapshots/${encodeURIComponent(id)}`),
  content: async (object) => {
    const result = await request<{ content: string }>(`objects/${encodeURIComponent(object)}`);
    return result.content;
  },
};
