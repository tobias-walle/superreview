import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { httpClient } from "../adapters/browser/client";
import type { Command, ReviewClient, Session } from "../lib/review/types";
import type { Draft } from "../lib/comments/model";
import { uid } from "../lib/comments/model";

const EXTERNAL_UPDATE_INTERVAL_MS = 2000;

function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"full" | "since">("full");
  const current = useRef(session);
  const client = useRef<ReviewClient | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    let alive = true;
    (async () => {
      const loaded = await httpClient.load();
      if (alive) {
        client.current = httpClient;
        current.current = loaded;
        setSession(loaded);
      }
    })().catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(work);
    queue.current = next.catch(() => {});
    return next.catch((e) => {
      setError(e.message);
      throw e;
    });
  };
  useEffect(() => {
    const timer = setInterval(() => {
      if (!client.current || !current.current) return;
      const sync = queue.current.then(async () => {
        const loaded = await client.current!.load();
        const old = current.current!;
        if (loaded.state.sequence <= old.state.sequence) return;
        const showingCurrentSnapshot = old.snapshot.id === old.state.snapshotId;
        const updated = {
          ...old,
          state: loaded.state,
          snapshot: showingCurrentSnapshot ? loaded.snapshot : old.snapshot,
        };
        current.current = updated;
        setSession(updated);
      });
      queue.current = sync.catch(() => {});
    }, EXTERNAL_UPDATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
  function execute(command: Command) {
    const id = uid();
    return enqueue(async () => {
      const next = await client.current!.execute(command, current.current!.state.sequence, id);
      const updated = { ...current.current!, state: next };
      current.current = updated;
      setSession(updated);
      setError("");
      return next;
    });
  }
  function saveDrafts(drafts: Draft[]) {
    const updated = { ...current.current!, drafts };
    current.current = updated;
    setSession(updated);
    return enqueue(async () => {
      const revision = await client.current!.saveDrafts(drafts, current.current!.draftRevision);
      const saved = { ...current.current!, draftRevision: revision };
      current.current = saved;
      setSession(saved);
    });
  }
  async function refresh(nextView: "full" | "since" = view) {
    setBusy(true);
    try {
      await enqueue(async () => {
        const loaded = await client.current!.refresh(nextView);
        current.current = loaded;
        setSession(loaded);
        setView(nextView);
        setError("");
      });
    } catch {
      /* Error is visible in the workspace. */
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    try {
      await enqueue(async () => {
        const loaded = await client.current!.load();
        const old = current.current!;
        // Returning from desktop simulation must pick up the iframe's feedback.
        const updated = {
          ...loaded,
          snapshot: old.snapshot.id === loaded.snapshot.id ? old.snapshot : loaded.snapshot,
        };
        current.current = updated;
        setSession(updated);
        setError("");
      });
    } catch {
      /* Keep the current review and show the connection error. */
    }
  }
  async function openSnapshot(id: string) {
    setBusy(true);
    try {
      const snapshot = await client.current!.snapshot(id);
      const next = { ...current.current!, snapshot };
      current.current = next;
      setSession(next);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return {
    session,
    error,
    busy,
    view,
    execute,
    saveDrafts,
    refresh,
    openSnapshot,
    reload,
    clearError: () => setError(""),
  };
}
const Context = createContext<ReturnType<typeof useSession> | null>(null);
export function ReviewSessionProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useSession()}>{children}</Context.Provider>;
}
export const useReviewSession = () => useContext(Context)!;
