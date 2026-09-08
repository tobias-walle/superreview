export type TimingLogger = (action: string, durationMs: number | null, detail?: string) => void;

export function createTimingLogger(
  enabled: boolean,
  write: (line: string) => void = (line) => process.stderr.write(line),
): TimingLogger | undefined {
  if (!enabled) return undefined;
  const origin = performance.now();
  return (action, durationMs, detail) => {
    const offset = (performance.now() - origin).toFixed(1);
    const status = durationMs === null ? "started" : `finished in ${durationMs.toFixed(1)}ms`;
    write(`[superreview +${offset}ms] ${action} ${status}${detail ? `: ${detail}` : ""}\n`);
  };
}

export function startTiming(logger: TimingLogger | undefined, action: string, detail?: string) {
  if (!logger) return (_detail?: string) => {};
  const started = performance.now();
  logger(action, null, detail);
  return (finishedDetail?: string) => logger(action, performance.now() - started, finishedDetail);
}
