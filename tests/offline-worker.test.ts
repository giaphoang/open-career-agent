import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('../scripts/offline-worker.template.js', import.meta.url), 'utf8');
type CacheStore = Map<string, Map<string, string>>;

/** Simulate distinct service worker registrations sharing one origin CacheStorage. */
function workerAt(scope: string, revision: string, storage: CacheStore) {
  const listeners = new Map<string, (event: any) => void>();
  const cacheStorage = {
    keys: async () => [...storage.keys()],
    delete: async (name: string) => storage.delete(name),
    open: async (name: string) => {
      let entries = storage.get(name);
      if (!entries) { entries = new Map(); storage.set(name, entries); }
      return {
        addAll: async (urls: string[]) => { for (const url of urls) entries!.set(url, scope + '|' + url); },
        match: async (request: string | { url: string }) => entries!.get(typeof request === 'string' ? request : request.url),
      };
    },
  };
  const self = {
    location: { origin: new URL(scope).origin },
    registration: { scope },
    addEventListener: (type: string, listener: (event: any) => void) => { listeners.set(type, listener); },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const script = template.replace('__OFFLINE_REVISION__', revision)
    .replace('__OFFLINE_ASSETS__', JSON.stringify(['./', './assets/app.js', './assets/app.css']));
  runInNewContext(script, {
    self, caches: cacheStorage, URL, Set, Promise, encodeURIComponent,
    fetch: async () => { throw new Error('offline'); },
    Response: { error: () => 'offline-error' },
  });

  async function lifecycle(name: 'install' | 'activate') {
    let completion: Promise<unknown> | undefined;
    listeners.get(name)!({ waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
    expect(completion, name).toBeDefined();
    await completion;
  }
  async function route(url: string, method = 'GET', mode = 'navigate') {
    let response: Promise<unknown> | undefined;
    listeners.get('fetch')!({
      request: { url, method, mode },
      respondWith: (promise: Promise<unknown>) => { response = promise; },
    });
    return { intercepted: !!response, value: await response };
  }
  return { install: () => lifecycle('install'), activate: () => lifecycle('activate'), route };
}

describe('versioned public offline shell', () => {
  it('isolates CacheStorage by service worker path so sibling Pages deployments remain offline', async () => {
    const shared: CacheStore = new Map();
    const aScope = 'https://user.github.io/career-a/';
    const bScope = 'https://user.github.io/career-b/';
    const a1 = workerAt(aScope, 'rev-a1', shared);
    await a1.install(); await a1.activate();
    const b1 = workerAt(bScope, 'rev-b1', shared);
    await b1.install(); await b1.activate();

    expect(shared.size).toBe(2);
    expect((await a1.route(aScope)).value).toBe(aScope + '|' + aScope);
    expect((await b1.route(bScope)).value).toBe(bScope + '|' + bScope);

    const a2 = workerAt(aScope, 'rev-a2', shared);
    await a2.install(); await a2.activate();
    const cacheNames = [...shared.keys()];
    expect(cacheNames).toHaveLength(2);
    expect(cacheNames.some(name => name.includes('%2Fcareer-a%2F') && name.endsWith('rev-a2'))).toBe(true);
    expect(cacheNames.some(name => name.includes('%2Fcareer-b%2F') && name.endsWith('rev-b1'))).toBe(true);
    expect((await b1.route(bScope)).value).toBe(bScope + '|' + bScope);
    expect((await a2.route(aScope)).value).toBe(aScope + '|' + aScope);
  });

  it('does not intercept unrelated requests or cache recruiter questions and model downloads', async () => {
    const shared: CacheStore = new Map();
    const scope = 'https://user.github.io/open-career-agent/';
    const worker = workerAt(scope, 'rev-1', shared);
    await worker.install(); await worker.activate();
    expect((await worker.route(scope + 'assets/app.js', 'GET', 'cors')).intercepted).toBe(true);
    expect((await worker.route(scope + 'api/search?q=private', 'GET', 'cors')).intercepted).toBe(false);
    expect((await worker.route(scope, 'POST')).intercepted).toBe(false);
    expect((await worker.route('https://cdn.example.net/model.onnx', 'GET', 'cors')).intercepted).toBe(false);
    const entries = [...shared.values()][0]!;
    expect([...entries.keys()]).toEqual([scope, scope + 'assets/app.js', scope + 'assets/app.css']);
  });
});
