import type { FaqOption } from './browser-llm';

/** In-browser wall-clock measurements. No data leaves the current tab. */
export interface WasmTiming { phase: 'startup' | 'query'; elapsedMs: number }

export interface WasmSearch {
  /** An embedding match is only related information, never proof of a claim. */
  select(question: string, options: readonly FaqOption[], signal: AbortSignal): Promise<number | null>;
  dispose(): void;
}

/** Invoke only after explicit consent: downloads model and WASM runtime from third parties. */
export function createWasmSearch(options: { signal: AbortSignal; onProgress?: (fraction: number) => void; onClosed?: () => void; onTiming?: (measurement: WasmTiming) => void }): Promise<WasmSearch> {
  if (options.signal.aborted) return Promise.reject(new Error('Canceled.'));
  if (typeof Worker === 'undefined') return Promise.reject(new Error('Web Workers are not supported.'));
  return new Promise((resolve, reject) => {
    const startupBeganAt = performance.now();
    let worker: Worker;
    try { worker = new Worker(new URL('./wasm-worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error('Could not start WASM worker.')); return; }
    let closed = false;
    let ready = false;
    let sequence = 0;
    let pending: { id: number; count: number; startedAt: number; cancelled: boolean; resolve: (index: number | null) => void; cleanup: () => void } | undefined;
    const startupTimer = setTimeout(() => failStart('Model loading timed out.'), 180_000);
    const abortStartup = () => failStart('Canceled.');
    function shutdown() {
      if (closed) return;
      closed = true;
      clearTimeout(startupTimer);
      options.signal.removeEventListener('abort', abortStartup);
      if (pending) { const request = pending; pending = undefined; request.cleanup(); request.resolve(null); }
      worker.terminate();
      if (ready) options.onClosed?.();
    }
    function failStart(message: string) { shutdown(); reject(new Error(message)); }
    function reportTiming(phase: WasmTiming['phase'], startedAt: number) {
      // Monitoring must never change whether an evidence-backed answer resolves.
      try { options.onTiming?.({ phase, elapsedMs: Math.max(0, performance.now() - startedAt) }); } catch { /* observer failure is non-fatal */ }
    }
    options.signal.addEventListener('abort', abortStartup, { once: true });
    if (options.signal.aborted) { abortStartup(); return; }
    worker.onerror = () => { if (ready) shutdown(); else failStart('Could not load the WASM model.'); };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (typeof value !== 'object' || value === null || !('type' in value)) return;
      if (value.type === 'progress' && 'progress' in value && typeof value.progress === 'number' && Number.isFinite(value.progress)) {
        options.onProgress?.(Math.max(0, Math.min(1, value.progress))); return;
      }
      if (value.type === 'error') { if (ready) shutdown(); else failStart('Could not load the WASM model.'); return; }
      if (value.type === 'ready' && !ready && !closed) {
        ready = true;
        clearTimeout(startupTimer);
        options.signal.removeEventListener('abort', abortStartup);
        reportTiming('startup', startupBeganAt);
        resolve({
          select(question, candidates, signal) {
            if (closed || pending || signal.aborted || !question.trim() || question.length > 2000 || candidates.length === 0 || candidates.length > 40) return Promise.resolve(null);
            const texts = candidates.map(candidate => candidate.questions.slice(0, 5).map(item => item.slice(0, 240)).join(' '));
            if (texts.some(text => !text.trim())) return Promise.resolve(null);
            const id = ++sequence;
            return new Promise<number | null>(done => {
              // Cancellation should not unload a large model on every fast follow-up.
              // The worker cannot interrupt inference, so reserve its in-flight slot
              // until that result arrives; subsequent queries fail safe (null) meanwhile.
              const abort = () => {
                if (pending?.id === id && !pending.cancelled) {
                  pending.cancelled = true;
                  signal.removeEventListener('abort', abort);
                  done(null);
                }
              };
              const timer = setTimeout(shutdown, 45_000);
              const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
              pending = { id, count: candidates.length, startedAt: performance.now(), cancelled: false, resolve: done, cleanup };
              signal.addEventListener('abort', abort, { once: true });
              if (signal.aborted) { pending = undefined; cleanup(); done(null); return; }
              try { worker.postMessage({ type: 'search', id, question, candidates: texts }); }
              catch { shutdown(); }
            });
          },
          dispose: shutdown,
        });
        return;
      }
      if (value.type === 'result' && pending && 'id' in value && value.id === pending.id && 'index' in value) {
        const request = pending; pending = undefined; request.cleanup();
        if (!request.cancelled) {
          const index = value.index;
          reportTiming('query', request.startedAt);
          request.resolve(typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < request.count ? index : null);
        }
      }
    };
    try { worker.postMessage({ type: 'init' }); }
    catch { failStart('Could not initialize WASM worker.'); }
  });
}
