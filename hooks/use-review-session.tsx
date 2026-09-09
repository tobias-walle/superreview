import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { httpClient } from "../adapters/browser/client";
import type {
  CaptureProgress,
  Command,
  ReadySession,
  ReviewClient,
  Session,
} from "../lib/review/types";
import type { Draft } from "../lib/comments/model";
import { uid } from "../lib/comments/model";

const CAPTURE_POLL_MS = 100;
const EXTERNAL_UPDATE_INTERVAL_MS = 2000;
const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const readySession = (session: Session): session is ReadySession => session.status === "ready";

function useSession() {
  const [session, setSession] = useState<ReadySession | null>(null);
  const [capture, setCapture] = useState<CaptureProgress | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"full" | "since">("full");
  const current = useRef<ReadySession | null>(session);
  const client = useRef<ReviewClient | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const apply = (loaded: Session) => {
    if (readySession(loaded)) {
      current.current = loaded;
      setSession(loaded);
      setCapture(null);
      setError("");
      return true;
    }
    if (loaded.status === "capturing") {
      setCapture(loaded.progress);
      setError("");
    } else {
      setCapture(null);
      setError(loaded.error);
    }
    return false;
  };
  useEffect(() => {
    let alive = true;
    client.current = httpClient;
    (async () => {
      while (alive) {
        const loaded = await httpClient.load();
        if (!alive || apply(loaded) || loaded.status === "error") return;
        await delay(CAPTURE_POLL_MS);
      }
    })().catch((e) => {
      if (alive) setError(e.message);
    });
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
        if (!readySession(loaded)) return;
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
      const active = current.current!;
      const next = await client.current!.execute(command, active.state.sequence, id);
      const updated = { ...active, state: next };
      current.current = updated;
      setSession(updated);
      setError("");
      return next;
    });
  }
  function saveDrafts(drafts: Draft[]) {
    const active = current.current!;
    const updated = { ...active, drafts };
    current.current = updated;
    setSession(updated);
    return enqueue(async () => {
      const latest = current.current!;
      const revision = await client.current!.saveDrafts(drafts, latest.draftRevision);
      const saved = { ...latest, draftRevision: revision };
      current.current = saved;
      setSession(saved);
    });
  }
  async function refresh(nextView: "full" | "since" = view) {
    setBusy(true);
    try {
      await enqueue(async () => {
        const loaded = await client.current!.refresh(nextView);
        if (!apply(loaded)) throw new Error("Capture did not finish.");
        setView(nextView);
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
        if (!readySession(loaded)) {
          apply(loaded);
          return;
        }
        const old = current.current!;
        const updated = {
          ...loaded,
          snapshot: old.snapshot.id === loaded.snapshot.id ? old.snapshot : loaded.snapshot,
        };
        current.current = updated;
        setSession(updated);
        setCapture(null);
        setError("");
      });
    } catch {
      /* Keep the current review and show the connection error. */
    }
  }
  const readContent = useCallback((object: string) => client.current!.content(object), []);
  async function openSnapshot(id: string) {
    setBusy(true);
    try {
      const snapshot = await client.current!.snapshot(id);
      const next: ReadySession = { ...current.current!, status: "ready", snapshot };
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
    capture,
    error,
    busy,
    view,
    execute,
    saveDrafts,
    refresh,
    openSnapshot,
    readContent,
    reload,
    clearError: () => setError(""),
  };
}
const Context = createContext<ReturnType<typeof useSession> | null>(null);
export function ReviewSessionProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useSession()}>{children}</Context.Provider>;
}
export const useReviewSession = () => useContext(Context)!;
