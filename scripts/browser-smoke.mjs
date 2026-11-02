import { createServer } from 'node:http';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir, cpus, totalmem } from 'node:os';
import { resolve, join, sep, extname } from 'node:path';
import assert from 'node:assert/strict';

const dist = resolve('dist');
const output = resolve('artifacts/browser-smoke');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
// macOS app bundles are normally not on PATH. Honor an explicit override
// first, then try standard system applications before POSIX executable names.
const macBrowsers = process.platform === 'darwin'
  ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium']
  : [];
const chrome = [process.env.CHROME_PATH, ...macBrowsers, 'google-chrome', 'chromium', 'chromium-browser']
  .filter(Boolean).find(bin => spawnSync(bin, ['--version']).status === 0);
if (!chrome) throw new Error('Chrome or Chromium required for browser smoke tests.');
const browser = spawnSync(chrome, ['--version'], { encoding: 'utf8' }).stdout.trim();
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    const file = resolve(dist, '.' + name, name.endsWith('/') ? 'index.html' : '');
    if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
    const contents = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(contents);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end();
  }
});
const pause = ms => new Promise(r => setTimeout(r, ms));
// Check computed browser colors, not CSS string assumptions. Only opaque,
// solid-background recruiter text is sampled; this is not a full WCAG audit.
function textContrastRatio(foreground, background) {
  const channels = css => {
    const rgb = css.match(/-?\d*\.?\d+/g)?.slice(0, 3).map(Number);
    assert(rgb?.length === 3 && rgb.every(n => Number.isFinite(n) && n >= 0 && n <= 255),
      'Invalid computed CSS color: ' + css);
    return rgb;
  };
  const luminance = css => {
    const [red, green, blue] = channels(css).map(value => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function assertReadableText(sample, viewport) {
  assert(sample?.background && sample?.foreground, viewport + ' missing text sample: ' + JSON.stringify(sample));
  const ratio = textContrastRatio(sample.foreground, sample.background);
  assert(ratio >= 4.5, viewport + ' low text contrast: ' + sample.selector + ' ' + ratio.toFixed(2) + ':1');
  assert(sample.fontSizePx >= sample.minFontPx,
    viewport + ' small text: ' + sample.selector + ' ' + sample.fontSizePx + 'px');
  return { ...sample, contrastRatio: Number(ratio.toFixed(2)) };
}

async function until(fn, message) {
  for (let i = 0; i < 120; i++) {
    try { const value = await fn(); if (value) return value; } catch {}
    await pause(100);
  }
  throw new Error(message);
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.addEventListener('open', ok, { once: true }); ws.addEventListener('error', fail, { once: true }); });
  let serial = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', event => {
    const data = JSON.parse(String(event.data));
    if (!data.id) {
      for (const listener of listeners) { try { listener(data); } catch { /* optional observer */ } }
      return;
    }
    if (!pending.has(data.id)) return;
    const next = pending.get(data.id); pending.delete(data.id); clearTimeout(next.timer);
    data.error ? next.reject(Error(data.error.message)) : next.resolve(data.result ?? {});
  });
  return { ws, onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); }, call(method, params = {}, sessionId) {
    return new Promise((ok, fail) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); fail(Error(method + ' timed out')); }, 15000);
      pending.set(id, { resolve: ok, reject: fail, timer });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  } };
}
let child, tmp;
try {
  await readFile(join(dist, 'index.html'));
  await mkdir(output, { recursive: true });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  tmp = await mkdtemp(join(tmpdir(), 'career-chrome-'));
  child = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-features=WebGPU', '--no-proxy-server', '--remote-debugging-port=0', '--remote-allow-origins=*', '--user-data-dir=' + tmp, 'about:blank'], { stdio: 'ignore' });
  const port = await until(() => {
    const f = join(tmp, 'DevToolsActivePort');
    return existsSync(f) ? Number(readFileSync(f, 'utf8').split('\n')[0]) : null;
  }, 'Chrome failed to start.');
  const target = await until(async () => (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find(t => t.type === 'page'), 'Chrome tab missing.');
  const { ws, call, onEvent } = await connect(target.webSocketDebuggerUrl);
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable'); await call('Accessibility.enable');
  async function pressEnter() {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    // CDP keyDown alone does not produce the Enter character/default action
    // in headless Chromium: dispatch the char event before keyUp.
    await call('Input.dispatchKeyEvent', { ...key, type: 'keyDown' });
    await call('Input.dispatchKeyEvent', { ...key, type: 'char', text: '\r' });
    await call('Input.dispatchKeyEvent', { ...key, type: 'keyUp' });
  }
  async function evaluate(expression) {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  }
  const results = [];
  for (const v of [{ name: 'desktop', width: 1280, height: 800, mobile: false }, { name: 'tablet', width: 800, height: 900, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }]) {
    await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await call('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: v.mobile });
    // Verify both CSS and JS motion preferences: desktop normal, mobile reduced.
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: v.mobile ? 'reduce' : 'no-preference' }] });
    const navigation = await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
    if (navigation.errorText) throw Error(navigation.errorText);
    await until(() => evaluate('document.readyState === "complete" && !!document.querySelector(".hero-example") && !!document.querySelector("#question")'), 'Page failed to render on ' + v.name);
    await evaluate(`(() => {
      const original = Element.prototype.scrollIntoView;
      window.__careerScrollOptions = null;
      Element.prototype.scrollIntoView = function(options) {
        window.__careerScrollOptions = options;
        return original.call(this, options);
      };
      return true;
    })()`);
    const layout = await evaluate(`(() => {
      const dev = document.querySelector('#for-developers');
      const exp = document.querySelector('#experience');
      const chat = document.querySelector('.chat-card');
      const profile = document.querySelector('.profile-card');
      return {
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
        developerTop: dev ? Math.round(dev.getBoundingClientRect().top + scrollY) : -1,
        developerHeight: dev?.getBoundingClientRect().height ?? 0,
        heading: document.querySelector('h1')?.textContent ?? '',
        demoDisclosure: (() => {
          const notice = document.querySelector('.demo-banner');
          if (!notice) return false;
          const rect = notice.getBoundingClientRect();
          return notice.textContent?.includes('fictional candidate') &&
            notice.textContent?.includes('not verified evidence') &&
            rect.top >= 0 && rect.top < innerHeight && rect.width > 0 && rect.height > 0;
        })(),
        developerLast: !!dev && !!exp && !!(exp.compareDocumentPosition(dev) & Node.DOCUMENT_POSITION_FOLLOWING),
        developerCollapsed: !document.querySelector('.developer-tools')?.open,
        chatFirst: !!chat && !!profile && chat.getBoundingClientRect().top <= profile.getBoundingClientRect().top + 1,
        chatWidth: Math.round(chat?.getBoundingClientRect().width ?? 0),
        profileWidth: Math.round(profile?.getBoundingClientRect().width ?? 0),
        chatLeft: Math.round(chat?.getBoundingClientRect().left ?? 0),
        profileLeft: Math.round(profile?.getBoundingClientRect().left ?? 0),
        formLabeled: !!document.querySelector('label[for="question"]'),
        sendLabeled: document.querySelector('.composer button')?.getAttribute('aria-label') === 'Send question'
      };
    })()`);
    assert.match(layout.heading, /Ask about the work/i);
    assert(layout.demoDisclosure, 'Fictional evidence must be disclosed in the first viewport on ' + v.name);
    assert(layout.developerLast && layout.developerCollapsed && layout.formLabeled && layout.sendLabeled);
    assert(layout.developerHeight > 0 && layout.developerTop < layout.scrollHeight, 'Developer footer must actually be visible in page layout.');
    assert(layout.width <= v.width + 2 && layout.scrollWidth <= layout.width + 2, v.name + ' has horizontal overflow or incorrect viewport scale.');
    if (v.mobile) {
      assert(layout.chatFirst, 'Mobile should show recruiter chat before sidebar.');
      assert(Math.abs(layout.chatWidth - layout.profileWidth) <= 2, 'Mobile recruiter chat and profile must share a full-width column.');
    } else {
      assert(layout.chatLeft < layout.profileLeft && layout.chatWidth > layout.profileWidth,
        v.name + ' must put the recruiter chat in the wider first column: ' + JSON.stringify(layout));
    }
    // Measure readable text in the live Chromium layout at each viewport.
    // Included in artifacts/browser-smoke/report.json for regression evidence.
    const readabilitySpecs = [
      ['.hero-copy > p:not(.hero-role):not(.demo-banner)', 14],
      ['.hero-copy > .demo-banner', 14],
      ['.hero-meta', 12],
      ['.chat-header p', 14],
      ['.chat-body .bubble', 14],
      ['.suggestions button', 12],
      ['.profile-card .bio', 14],
      ['.profile-card .headline', 14],
      ['.profile-card .sources a', 12],
      ['.project-content p', 14],
      ['.timeline p', 14],
      ['.footer p', 11]
    ];
    const readability = (await evaluate(`(() => {
      window.__careerTextSample = (selector, minFontPx) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, minFontPx, missing: true };
        let ancestor = element, background = null;
        while (ancestor) {
          const candidate = getComputedStyle(ancestor).backgroundColor;
          if (candidate !== 'transparent' && candidate !== 'rgba(0, 0, 0, 0)') {
            background = candidate;
            break;
          }
          ancestor = ancestor.parentElement;
        }
        return { selector, minFontPx, background,
          foreground: getComputedStyle(element).color,
          fontSizePx: parseFloat(getComputedStyle(element).fontSize) };
      };
      return ${JSON.stringify(readabilitySpecs)}.map(([selector, minFontPx]) =>
        window.__careerTextSample(selector, minFontPx));
    })()`)).map(sample => assertReadableText(sample, v.name));
    // A keyboard-only recruiter can bypass navigation and the long hero to reach chat.
    // Trigger the real Enter key on the focused skip link; .click() alone would
    // miss browser focus and default-action regressions.
    await call('Page.bringToFront');
    const tab = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
    await call('Input.dispatchKeyEvent', { ...tab, type: 'keyDown' });
    await call('Input.dispatchKeyEvent', { ...tab, type: 'keyUp' });
    const skipLink = await evaluate(`(() => {
      const skip = document.querySelector('.skip-link');
      if (!skip) return null;
      const box = skip.getBoundingClientRect();
      return {
        first: document.querySelector('#root')?.firstElementChild === skip,
        focused: document.activeElement === skip,
        focusRule: skip.matches(':focus'),
        label: skip.textContent?.trim(),
        target: skip.getAttribute('href'),
        top: box.top,
        width: box.width,
        height: box.height
      };
    })()`);
    assert(skipLink?.first && skipLink.focused && skipLink.label === 'Skip to interview chat' && skipLink.target === '#conversation',
      'Keyboard skip link must be the first element and point to recruiter chat.');
    assert(skipLink.top >= 0 && skipLink.width >= 44 && skipLink.height >= 44,
      'Focused skip link must be visible and usable in ' + v.name + ': ' + JSON.stringify(skipLink));
    await pressEnter();
    await until(() => evaluate('document.activeElement?.id === "question"'),
      'Enter on skip link did not focus the recruiter question field on ' + v.name);
    // Measure real Chromium computed styles and visible control geometry.
    // These checks prevent regressions to iOS-triggering 12px input text and
    // undersized tap targets without claiming an actual iOS device audit.
    let mobileUsability = null;
    if (v.mobile) {
      mobileUsability = await evaluate(`(() => {
        const selectors = [
          '.composer button', '.chat-tools button', '.suggestions button',
          '.skill-buttons button', '.project-content .tags button',
          '.hero-actions button', '.hero-example', '.top-contact'
        ];
        return {
          inputFontPx: parseFloat(getComputedStyle(document.querySelector('.composer input')).fontSize),
          answerFontPx: parseFloat(getComputedStyle(document.querySelector('.bubble')).fontSize),
          controls: selectors.map(selector => {
            const el = document.querySelector(selector);
            const box = el?.getBoundingClientRect();
            return { selector, width: box?.width ?? 0, height: box?.height ?? 0 };
          })
        };
      })()`);
      assert(mobileUsability.inputFontPx >= 16, 'Mobile question input must render at least 16px to avoid Safari focus zoom.');
      assert(mobileUsability.answerFontPx >= 15, 'Mobile recruiter answer text is too small.');
      for (const target of mobileUsability.controls) {
        assert(target.width >= 44 && target.height >= 44,
          target.selector + ' needs a 44x44px mobile touch target, got ' + target.width + 'x' + target.height);
      }
    }
    const ax = await call('Accessibility.getFullAXTree');
    const names = ax.nodes.filter(n => n.role?.value === 'button').map(n => n.name?.value);
    assert(names.includes('Ask about experience') && names.includes('Send question'), 'Recruiter controls need accessible button names: ' + JSON.stringify(names));
    // Installation precaches the full deterministic entry bundle before the
    // browser loses connectivity; a page-only offline check misses this gate.
    await until(() => evaluate('!!navigator.serviceWorker?.controller'),
      'Offline static shell did not activate on ' + v.name);
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await evaluate('document.querySelector(".hero-example").click(); true');
    await until(() => evaluate('document.querySelectorAll(".exchange .sources a").length > 0'), 'Offline evidence-backed answer failed on ' + v.name);
    assert(await evaluate('([...document.querySelectorAll(".exchange .sources a")].every(link => link.textContent?.includes("DEMO PLACEHOLDER — NOT VERIFIED")))'),
      'Placeholder source links must be clearly marked non-verifying on ' + v.name);
    readability.push(assertReadableText(
      await evaluate("window.__careerTextSample('.exchange .sources a', 12)"), v.name));
    // Actual keyboard event path, not a JS .click(): activate the main recruiter
    // CTA, type a question, submit with Enter, and toggle developer details.
    await evaluate('document.querySelector(".hero-actions button").focus(); true');
    await pressEnter();
    await until(() => evaluate('document.activeElement?.id === "question"'), 'Keyboard recruiter CTA did not focus the composer on ' + v.name);
    const keyboard = await evaluate(`(() => {
      const composer = document.querySelector('.composer');
      return {
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scrollBehavior: window.__careerScrollOptions?.behavior,
        composerFocusOutline: getComputedStyle(composer).outlineWidth,
        conversationRole: document.querySelector('.chat-body')?.getAttribute('role'),
        conversationLabel: document.querySelector('.chat-body')?.getAttribute('aria-label')
      };
    })()`);
    assert.equal(keyboard.reducedMotion, v.mobile, 'Browser motion preference mismatch.');
    assert.equal(keyboard.scrollBehavior, v.mobile ? 'auto' : 'smooth', 'Recruiter CTA must respect reduced motion.');
    assert.equal(keyboard.composerFocusOutline, '3px', 'Keyboard composer focus needs a visible outline.');
    assert.equal(keyboard.conversationRole, 'log', 'Screen readers need a conversation log landmark.');
    assert(keyboard.conversationLabel, 'Conversation log needs an accessible name.');
    await call('Input.insertText', { text: 'Have you designed scalable Java systems?' });
    await until(() => evaluate('document.querySelector("#question").value.includes("Have you designed scalable Java systems?")'), 'Keyboard text entry failed on ' + v.name);
    await pressEnter();
    await until(() => evaluate('document.querySelectorAll(".exchange").length >= 2 && document.querySelectorAll(".exchange .sources a").length >= 2'), 'Keyboard question did not return cited evidence offline on ' + v.name);
    await evaluate('document.querySelector(".developer-tools summary").focus(); true');
    await pressEnter();
    assert(await evaluate('document.querySelector(".developer-tools").open'), 'Keyboard must open developer details on ' + v.name);
    await pressEnter();
    assert(!(await evaluate('document.querySelector(".developer-tools").open')), 'Keyboard must close developer details on ' + v.name);
    // Chat content changes document height; measure AFTER the answer so full-page proof includes the footer.
    const screenshotHeight = await evaluate('document.documentElement.scrollHeight');
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: v.width, height: screenshotHeight, scale: 1 } });
    await writeFile(join(output, v.name + '.png'), Buffer.from(screenshot.data, 'base64'));
    results.push({ viewport: v.name, keyboardSkipLink: skipLink, readability, ...layout, ...(mobileUsability ? { mobileUsability } : {}), ...keyboard, keyboardSubmitted: true, keyboardDeveloperDisclosure: true, screenshotHeight, evidenceLinks: await evaluate('document.querySelectorAll(".exchange .sources a").length') });
  }

  // Genuine cold *navigation* while offline: a prior network-loaded SPA must
  // reopen with its static JS/CSS and deterministic evidence already cached.
  // Chat input remains in memory only and must NOT survive this navigation.
  const offlineNav = await call('Page.navigate', {
    url: 'http://127.0.0.1:' + server.address().port + '/'
  });
  if (offlineNav.errorText) throw Error('Offline navigation failed: ' + offlineNav.errorText);
  await until(() => evaluate('document.readyState === "complete" && !!document.querySelector("#question") && !!document.querySelector(".hero-example")'),
    'Offline navigation could not render the deterministic app shell.');
  assert.equal(await evaluate('document.querySelectorAll(".exchange").length'), 0,
    'Reload must not persist the previous private recruiter conversation.');
  await evaluate('document.querySelector(".hero-example").click(); true');
  await until(() => evaluate('document.querySelectorAll(".exchange .sources a").length > 0'),
    'New offline navigation did not return deterministic cited evidence.');
  const offlineNavigation = {
    viewport: 'mobile', staticShellLoaded: true, conversationReset: true,
    serviceWorkerControlled: await evaluate('!!navigator.serviceWorker?.controller'),
    evidenceLinks: await evaluate('document.querySelectorAll(".exchange .sources a").length')
  };
  assert(offlineNavigation.serviceWorkerControlled && offlineNavigation.evidenceLinks > 0,
    'Offline reload requires active service worker and cited evidence.');
  const offlineHeight = await evaluate('document.documentElement.scrollHeight');
  const offlineScreenshot = await call('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 390, height: offlineHeight, scale: 1 }
  });
  await writeFile(join(output, 'offline-navigation.png'), Buffer.from(offlineScreenshot.data, 'base64'));
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // Opt-in REAL model evaluation. This path downloads the actual quantized WASM
  // model, so regular smoke CI remains deterministic, offline, and fast.
  // Example: RUN_WASM_EVAL=1 WASM_EVAL_PER_CATEGORY=8 node scripts/browser-smoke.mjs
  let wasmEvaluation = null;
  if (process.env.RUN_WASM_EVAL === '1') {
    const sample = JSON.parse(await readFile('tests/fixtures/sample-profile.json', 'utf8'));
    assert.deepEqual(JSON.parse(await readFile('src/data/profile.json', 'utf8')), sample,
      'The real-model evaluation requires the fictional sample profile to match the labeled corpus.');
    const corpus = JSON.parse(await readFile('tests/fixtures/retrieval-corpus.json', 'utf8'));
    const holdout = JSON.parse(await readFile('tests/fixtures/retrieval-holdout.json', 'utf8'));
    const perCategory = Number(process.env.WASM_EVAL_PER_CATEGORY ?? 8);
    assert(Number.isSafeInteger(perCategory) && perCategory >= 1 && perCategory <= 100, 'WASM_EVAL_PER_CATEGORY must be 1-100.');
    assert.equal(corpus.version, 1);
    assert.equal(holdout.version, 1);
    const categories = ['paraphrases', 'unrelated', 'sensitive', 'ambiguous'];
    // Keep the original exploratory dataset separate from newly authored,
    // untouched questions. Only calibration cases may guide threshold choices.
    const rowsFor = (dataset, split) => categories.flatMap(category =>
      dataset[category].slice(0, perCategory).map(row => ({ split, category, ...row })));
    const rows = [...rowsFor(corpus, 'calibration'), ...rowsFor(holdout, 'holdout')];
    const waitModel = async (fn, timeoutMs, error) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = await fn();
        if (value) return value;
        await pause(150);
      }
      throw new Error(error);
    };
    const benchmarkReport = { method: 'Real quantized MiniLM WASM in Chromium; explicit opt-in; browser UI end-to-end; synthetic fictional data', 
      corpusVersion: corpus.version, browser, node: process.version, platform: process.platform, architecture: process.arch,
      runnerHardware: { cpuModel: cpus()[0]?.model ?? 'unknown', logicalCores: cpus().length, visibleRamGiB: Number((totalmem() / 1024 ** 3).toFixed(1)) },
      model: 'Xenova/all-MiniLM-L6-v2', modelRevision: '751bff37182d3f1213fa05d7196b954e230abad9',
      perCategory, totalCorpusCases: categories.reduce((sum, category) => sum + corpus[category].length + holdout[category].length, 0), calibrationCases: rows.filter(row => row.split === 'calibration').length,
      holdoutCases: rows.filter(row => row.split === 'holdout').length, holdoutVersion: holdout.version,
      sampledCases: rows.length, results: [], limitations: 'Headless Chromium on the reported host; GPU/WebGPU disabled; not a mobile device or Safari test. Model/runtime bytes are CDP-observed uncached encoded transfers in this run; UI wall time includes rendering; worker timings are separately displayed. No validation that linked evidence substantiates claims.' };
    try {
      // Track actual completed remote transfer bytes for model/runtime downloads.
      // Workers use separate CDP sessions: page-only Network events miss them.
      // Pause newly attached workers until Network is enabled to avoid missing
      // the first model download. Only aggregate public CDN hostnames and sizes.
      const remoteRequests = new Map();
      const transfersByHost = new Map();
      const meterErrors = [];
      const keyFor = (sessionId, requestId) => (sessionId ?? 'page') + ':' + requestId;
      const unobserve = onEvent(({ method, params = {}, sessionId }) => {
        if (method === 'Target.attachedToTarget' && params.sessionId) {
          void call('Network.enable', {}, params.sessionId)
            .catch(error => meterErrors.push('Network enable: ' + String(error)))
            .finally(() => call('Runtime.runIfWaitingForDebugger', {}, params.sessionId)
              .catch(error => meterErrors.push('Worker resume: ' + String(error))));
          return;
        }
        if (method === 'Network.requestWillBeSent') {
          try {
            const url = new URL(params.request?.url);
            if (url.protocol !== 'https:' || !url.hostname) return;
            remoteRequests.set(keyFor(sessionId, params.requestId), { host: url.hostname.toLowerCase(), cached: false });
          } catch { /* ignore local and non-URL requests */ }
        } else if (method === 'Network.requestServedFromCache') {
          const request = remoteRequests.get(keyFor(sessionId, params.requestId));
          if (request) request.cached = true;
        } else if (method === 'Network.responseReceived') {
          const request = remoteRequests.get(keyFor(sessionId, params.requestId));
          if (request && (params.response?.fromDiskCache || params.response?.fromServiceWorker)) request.cached = true;
        } else if (method === 'Network.loadingFinished') {
          const id = keyFor(sessionId, params.requestId);
          const request = remoteRequests.get(id);
          if (!request) return;
          remoteRequests.delete(id);
          const bytes = params.encodedDataLength;
          const current = transfersByHost.get(request.host) ?? { requests: 0, encodedBytes: 0, cached: 0 };
          current.requests++;
          if (request.cached) current.cached++;
          if (Number.isFinite(bytes) && bytes >= 0 && !request.cached) current.encodedBytes += bytes;
          transfersByHost.set(request.host, current);
        } else if (method === 'Network.loadingFailed') {
          remoteRequests.delete(keyFor(sessionId, params.requestId));
        }
      });
      await call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
      // Instrument worker result metadata ONLY inside the opt-in benchmark tab.
      // Do not log prompts, vectors, personal data, or send results off-device.
      await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
        window.__wasmRankSamples = [];
        const OriginalWorker = window.Worker;
        window.Worker = class extends OriginalWorker {
          constructor(...args) {
            super(...args);
            this.addEventListener('message', event => {
              if (event.data?.type === 'result' && event.data?.ok === true && event.data?.ranking) {
                window.__wasmRankSamples.push({ ...event.data.ranking, selectedIndex: event.data.index });
              }
            });
          }
        };
      })()` });
      await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      const navigation = await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
      if (navigation.errorText) throw new Error(navigation.errorText);
      await until(() => evaluate('document.readyState === "complete" && !!document.querySelector(".developer-tools")'), 'Benchmark page did not load.');
      const pressed = await evaluate('(() => {document.querySelector(".developer-tools").open = true; document.querySelector(".template-options").open = true; document.querySelector(".model-panel").open = true; const button = [...document.querySelectorAll(".model-content button")].find(b => b.textContent.includes("Enable WASM search")); if (!button) return false; button.click(); return true;})()');
      assert(pressed, 'Could not opt into WASM search.');
      const beganAt = Date.now();
      const status = await waitModel(async () => {
        const label = await evaluate('document.querySelectorAll(".model-content .model-status")[1]?.textContent ?? ""');
        return label.includes('Enabled on this device') ? 'ready' : label.includes('Could not start') ? 'error: ' + label : null;
      }, 180_000, 'Real WASM model failed to become ready within 180 seconds.');
      assert.equal(status, 'ready', 'Actual WASM startup failed: ' + status);
      benchmarkReport.modelReadyWallMs = Date.now() - beganAt;
      benchmarkReport.userAgent = await evaluate('navigator.userAgent');
      // Loading is complete before queries begin: this is cold model/runtime
      // transfer, not the size of subsequent 154 local inference requests.
      benchmarkReport.modelNetworkTransfer = {
        method: 'CDP Network.loadingFinished encodedDataLength from page and auto-attached workers',
        encodedBytes: [...transfersByHost.values()].reduce((sum, item) => sum + item.encodedBytes, 0),
        requests: [...transfersByHost.values()].reduce((sum, item) => sum + item.requests, 0),
        hosts: Object.fromEntries([...transfersByHost].sort(([a], [b]) => a.localeCompare(b))),
        meterErrors,
        limitation: 'Encoded response transfer sizes on a fresh Chromium profile, not model weight size or a browser cache/real-phone measurement.'
      };
      unobserve();
      await call('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
      assert(benchmarkReport.modelNetworkTransfer.encodedBytes > 0 && benchmarkReport.modelNetworkTransfer.requests > 0,
        'CDP saw no remote model/runtime transfer bytes; do not publish a zero-byte benchmark as a measurement.');
      assert.deepEqual(meterErrors, [], 'CDP worker sessions must be instrumented before reporting transfer bytes.');

      for (const row of rows) {
        const count = await evaluate('document.querySelectorAll(".exchange").length');
        const previousRankings = await evaluate('window.__wasmRankSamples?.length ?? 0');
        // Mutation observer tracks asynchronous inference separately from the
        // immediate deterministic reply; it does not require any production hooks.
        await evaluate('(() => {window.__wasmProbeObserver?.disconnect(); window.__wasmProbe = {started:false, finished:false}; window.__wasmProbeObserver = new MutationObserver(() => {const visible = !!document.querySelector(".model-searching"); if (visible) window.__wasmProbe.started=true; else if (window.__wasmProbe.started) window.__wasmProbe.finished=true;}); window.__wasmProbeObserver.observe(document.querySelector(".chat-body"), {childList:true, subtree:true}); return true;})()');
        await evaluate('document.querySelector("#question").focus(); true');
        const startedAt = performance.now();
        await call('Input.insertText', { text: row.question });
        await pressEnter();
        await until(() => evaluate('document.querySelectorAll(".exchange").length > ' + count), 'No reply to synthetic query: ' + row.question);
        const initial = await evaluate('document.querySelector(".exchange:last-child .agent-message .bubble")?.textContent ?? ""');
        const probe = await evaluate('window.__wasmProbe');
        // Only unknown deterministic answers invoke the optional WASM adapter.
        const shouldRunWasm = initial.includes("I don't have enough public evidence") || probe.started;
        if (shouldRunWasm) {
          await waitModel(() => evaluate('window.__wasmProbe.finished'), 50_000, 'WASM inference did not complete: ' + row.question);
        }
        const finalText = await evaluate('document.querySelector(".exchange:last-child .agent-message .bubble")?.textContent ?? ""');
        const traced = await evaluate('window.__wasmProbe');
        const evidenceLinks = await evaluate('document.querySelectorAll(".exchange:last-child .sources a").length');
        const ranking = traced.started ? await evaluate(`window.__wasmRankSamples.length > ${previousRankings} ? window.__wasmRankSamples.at(-1) : null`) : null;
        // Never infer the FAQ ID by searching answer text: multiple distinct
        // authored FAQs may share IDENTICAL answers (e.g. leadership/order-role).
        // Use the worker's actual selected index to avoid false misclassification.
        const selectedFaq = ranking && Number.isSafeInteger(ranking.selectedIndex) && ranking.selectedIndex >= 0
          ? sample.faq[ranking.selectedIndex] : null;
        // Ranking is the raw worker choice; the UI can conservatively suppress
        // a related FAQ whose answer does not support a quantitative premise.
        // Keep raw scores comparable across runs and measure displayed choices
        // separately, without counting a suppressed suggestion as a UI claim.
        const displayedFaq = selectedFaq && evidenceLinks > 0 &&
          finalText.includes('Related information from the public profile: ' + selectedFaq.answer) &&
          finalText.includes('I can’t verify the specific claim') ? selectedFaq : null;
        if (selectedFaq) assert(displayedFaq || (evidenceLinks === 0 &&
          finalText.includes("I don't have enough public evidence")),
          'A selected WASM FAQ must appear with its exact answer and sources or retain a safe evidence-free abstention.');
        const result = { split: row.split, category: row.category, question: row.question,
          ...(row.faqId ? { expectedFaqId: row.faqId } : {}),
          wasmAttempt: traced.started, returnedFaqId: selectedFaq?.id ?? null,
          displayedFaqId: displayedFaq?.id ?? null,
          guardedSuggestion: !!selectedFaq && !displayedFaq,
          privateRefusal: finalText.includes('I can only discuss information the candidate chose to publish'), evidenceLinks,
          ...(ranking ? { ranking: { ...ranking, bestFaqId: sample.faq[ranking.bestIndex]?.id ?? null } } : {}),
          elapsedUiMs: Number((performance.now() - startedAt).toFixed(1)) };
        benchmarkReport.results.push(result);
        if (ranking) {
          const predicted = ranking.bestCosine >= 0.48 &&
            (ranking.runnerUpCosine === null || ranking.bestCosine - ranking.runnerUpCosine >= 0.04)
            ? sample.faq[ranking.bestIndex]?.id ?? null : null;
          assert.equal(predicted, selectedFaq?.id ?? null, 'Worker score trace must reproduce the active ranking result.');
        }
        if (row.category === 'sensitive') assert(!result.wasmAttempt && result.privateRefusal, 'Sensitive query reached the model or was not refused: ' + row.question);
      }
      const summarize = results => Object.fromEntries(categories.map(category => {
        const subset = results.filter(row => row.category === category);
        const actual = subset.filter(row => row.wasmAttempt);
        return [category, { checked: subset.length, modelAttempts: actual.length,
          selectedFaqs: actual.filter(row => row.returnedFaqId !== null).length,
          displayedFaqs: actual.filter(row => row.displayedFaqId !== null).length,
          guardedSuggestions: actual.filter(row => row.guardedSuggestion).length,
          correctSelections: actual.filter(row => row.returnedFaqId === row.expectedFaqId && !!row.expectedFaqId).length,
          wrongSelections: actual.filter(row => row.returnedFaqId !== null && row.returnedFaqId !== row.expectedFaqId).length }];
      }));
      benchmarkReport.summary = summarize(benchmarkReport.results);
      benchmarkReport.summaryBySplit = Object.fromEntries(['calibration', 'holdout'].map(split =>
        [split, summarize(benchmarkReport.results.filter(row => row.split === split))]));
      const calibration = benchmarkReport.summaryBySplit.calibration;
      const heldOut = benchmarkReport.summaryBySplit.holdout;
      const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
      benchmarkReport.correctFaqRate = rate(calibration.paraphrases.correctSelections, calibration.paraphrases.modelAttempts);
      benchmarkReport.unrelatedFalseRelatedRate = rate(calibration.unrelated.selectedFaqs, calibration.unrelated.modelAttempts);
      benchmarkReport.holdoutCorrectFaqRate = rate(heldOut.paraphrases.correctSelections, heldOut.paraphrases.modelAttempts);
      benchmarkReport.holdoutUnrelatedFalseRelatedRate = rate(heldOut.unrelated.selectedFaqs, heldOut.unrelated.modelAttempts);
      benchmarkReport.summaryNote = 'Calibration and holdout rates use actual WASM attempts. Holdout labels were authored after exploratory scoring, but repeated reuse would invalidate independence.';
      const scored = benchmarkReport.results.filter(row => row.wasmAttempt && row.ranking);
      benchmarkReport.scoredModelAttempts = scored.length;
      const replayGrid = (subset) => [0.48, 0.52, 0.56, 0.60].flatMap(minCosine =>
        [0.04, 0.06, 0.08, 0.10, 0.12].map(minMargin => {
          const predicted = subset.map(row => ({
            ...row,
            candidate: row.ranking.bestCosine >= minCosine &&
              (row.ranking.runnerUpCosine === null || row.ranking.bestCosine - row.ranking.runnerUpCosine >= minMargin)
              ? row.ranking.bestFaqId : null
          }));
          const paraphrases = predicted.filter(row => row.category === 'paraphrases');
          const unrelated = predicted.filter(row => row.category === 'unrelated');
          const ambiguous = predicted.filter(row => row.category === 'ambiguous');
          return { minCosine, minMargin, scoredAttempts: predicted.length,
            paraphraseCorrect: paraphrases.filter(row => row.candidate === row.expectedFaqId).length,
            paraphraseWrong: paraphrases.filter(row => row.candidate !== null && row.candidate !== row.expectedFaqId).length,
            paraphraseAbstentions: paraphrases.filter(row => row.candidate === null).length,
            unrelatedFalseRelated: unrelated.filter(row => row.candidate !== null).length,
            ambiguousSuggestions: ambiguous.filter(row => row.candidate !== null).length };
        }));
      benchmarkReport.thresholdGrid = replayGrid(scored.filter(row => row.split === 'calibration'));
      benchmarkReport.holdoutThresholdGrid = replayGrid(scored.filter(row => row.split === 'holdout'));
      const baseline = benchmarkReport.thresholdGrid.find(row => row.minCosine === 0.48 && row.minMargin === 0.04);
      const holdoutBaseline = benchmarkReport.holdoutThresholdGrid.find(row => row.minCosine === 0.48 && row.minMargin === 0.04);
      assert.equal(baseline.paraphraseCorrect, calibration.paraphrases.correctSelections, 'Calibration scores must reproduce WASM correct matches.');
      assert.equal(baseline.unrelatedFalseRelated, calibration.unrelated.selectedFaqs, 'Calibration scores must reproduce WASM false suggestions.');
      assert.equal(holdoutBaseline.paraphraseCorrect, heldOut.paraphrases.correctSelections, 'Holdout scores must reproduce WASM correct matches.');
      assert.equal(holdoutBaseline.unrelatedFalseRelated, heldOut.unrelated.selectedFaqs, 'Holdout scores must reproduce WASM false suggestions.');
      benchmarkReport.calibrationLimitation = 'The 106 older synthetic questions are calibration data. The 48 new questions are a first independent holdout; never optimize based on its results and then call it independent. Physical mobile-device validation is outside this run.';

      // A reproducible regression budget, not a claim of calibrated model accuracy.
      // Sampled local runs cannot be compared to the entire 154-case population.
      const completeCorpus = benchmarkReport.sampledCases === benchmarkReport.totalCorpusCases;
      const checks = [
        { name: 'calibration correct FAQ floor', observed: calibration.paraphrases.correctSelections, threshold: '>=23', pass: calibration.paraphrases.correctSelections >= 23 },
        { name: 'calibration wrong FAQ ceiling', observed: calibration.paraphrases.wrongSelections, threshold: '<=7', pass: calibration.paraphrases.wrongSelections <= 7 },
        { name: 'holdout paraphrase wrong FAQ ceiling', observed: heldOut.paraphrases.wrongSelections, threshold: '=0', pass: heldOut.paraphrases.wrongSelections === 0 },
        { name: 'unrelated raw model suggestions', observed: benchmarkReport.summary.unrelated.selectedFaqs, threshold: '=0', pass: benchmarkReport.summary.unrelated.selectedFaqs === 0 },
        { name: 'ambiguous displayed model suggestions', observed: benchmarkReport.summary.ambiguous.displayedFaqs, threshold: '=0', pass: benchmarkReport.summary.ambiguous.displayedFaqs === 0 },
        { name: 'sensitive request refusal before inference', observed: benchmarkReport.results.filter(row => row.category === 'sensitive' && (row.wasmAttempt || !row.privateRefusal)).length, threshold: '=0', pass: benchmarkReport.results.every(row => row.category !== 'sensitive' || (!row.wasmAttempt && row.privateRefusal)) },
      ];
      benchmarkReport.qualityGate = {
        basis: 'PR #30 full Chromium synthetic baseline (2026-11-02); future independent evidence is required',
        evaluated: completeCorpus,
        passed: completeCorpus ? checks.every(check => check.pass) : null,
        checks,
      };
      if (completeCorpus) assert(benchmarkReport.qualityGate.passed,
        'WASM synthetic quality regression: ' + checks.filter(check => !check.pass).map(check => check.name + ' (' + check.observed + ' ' + check.threshold + ')').join(', '));
      benchmarkReport.performancePanel = await evaluate('Object.fromEntries([...document.querySelectorAll(".performance-panel dl div")].map(row => [row.querySelector("dt")?.textContent ?? "", row.querySelector("dd")?.textContent ?? ""]))');
      wasmEvaluation = benchmarkReport;
    } catch (error) {
      benchmarkReport.error = String(error);
      await writeFile(join(output, 'wasm-relevance.json'), JSON.stringify(benchmarkReport, null, 2) + '\n');
      throw error;
    }
    await writeFile(join(output, 'wasm-relevance.json'), JSON.stringify(benchmarkReport, null, 2) + '\n');
    console.log('Real WASM evaluation summary: ' + JSON.stringify({ summary: benchmarkReport.summary, modelNetworkTransfer: benchmarkReport.modelNetworkTransfer, performancePanel: benchmarkReport.performancePanel }, null, 2));
  }
  // Deterministic integration coverage through the actual native adapter. The
  // Prompt API is mocked here; real-device model quality is measured separately.
  const fixtureProfile = JSON.parse(await readFile('src/data/profile.json', 'utf8'));
  // A valid fact ID must NOT launder a fabricated model claim into a cited answer.
  const fixtureAnswer = { kind: 'answer', text: 'Alex was CTO at Fabricated Labs.', factIds: ['projects.0'] };
  const fixtureScript = await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__nativeCalls = { availability: 0, create: 0 };
    Object.defineProperty(globalThis, 'LanguageModel', { configurable: true, value: {
      availability: async () => {
        window.__nativeCalls.availability++;
        return new URL(location.href).searchParams.get('nativeFixture') ?? 'available';
      },
      create: options => new Promise(resolve => {
        window.__nativeCalls.create++;
        const monitor = new EventTarget();
        options.monitor?.(monitor);
        window.__nativeSetupProgress = loaded => {
          const event = new Event('downloadprogress');
          Object.defineProperty(event, 'loaded', { value: loaded });
          monitor.dispatchEvent(event);
        };
        window.__nativeSetupReady = () => resolve({
          clone: async () => ({ prompt: () => new Promise((resolve, reject) => {
            window.__nativeFinish = () => resolve(${JSON.stringify(JSON.stringify(fixtureAnswer))});
            window.__nativeFail = () => reject(new Error('Synthetic inference failure'));
          }), destroy() {} }), destroy() {}
        });
      })
    }});
  ` });
  const nativeChatFixture = { method: 'Mocked Prompt API; real app and adapter; no native model downloaded or inference benchmark', results: [] };
  async function nativeControls(viewport) {
    const controls = await evaluate(`(() => {
      const panel = document.querySelector('.chat-model');
      if (!panel) return null;
      panel.scrollIntoView({behavior:'instant',block:'center'});
      const box = panel.getBoundingClientRect();
      const statuses = document.querySelectorAll('.model-content .model-status');
      return {
        inChat: document.querySelector('.chat-card').contains(panel),
        label: panel.getAttribute('aria-label'),
        visible: box.width > 0 && box.height > 0 && !panel.closest('details:not([open])'),
        developerCollapsed: !document.querySelector('.developer-tools').open,
        wasmStatusOrder: statuses[0] === panel.querySelector('.model-status') &&
          statuses[1] === document.querySelector('.developer-tools .model-content .model-status'),
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        status: panel.querySelector('.model-status')?.textContent,
        progress: panel.querySelector('progress') ? {
          value: panel.querySelector('progress').getAttribute('value'),
          max: panel.querySelector('progress').getAttribute('max'),
          label: panel.querySelector('progress').getAttribute('aria-label')
        } : null,
        buttons: [...panel.querySelectorAll('button')].map(button => {
          const rect = button.getBoundingClientRect();
          return {name:button.textContent.trim(),disabled:button.disabled,width:rect.width,height:rect.height};
        }),
        calls: {...window.__nativeCalls}
      };
    })()`);
    assert(controls?.inChat && controls.visible && controls.developerCollapsed,
      'Chrome controls must be visible directly in chat with developer settings closed on ' + viewport);
    assert.equal(controls.label, 'Chrome LLM API controls');
    assert(controls.wasmStatusOrder, 'Real WASM benchmark must retain its second model-status selector.');
    assert(controls.scrollWidth <= controls.width + 2, 'Model controls overflow on ' + viewport);
    assert(controls.buttons.length > 0 && controls.buttons.every(button => button.width >= 44 && button.height >= 44),
      'Model controls need 44px targets on ' + viewport + ': ' + JSON.stringify(controls.buttons));
    return controls;
  }
  for (const v of [{name:'desktop',width:1280,height:900,mobile:false},{name:'mobile',width:390,height:844,mobile:true}]) {
    await call('Emulation.setDeviceMetricsOverride', {width:v.width,height:v.height,mobile:v.mobile,deviceScaleFactor:1});
    const availability = [];
    for (const [state, name] of [['available','Enable on-device model'], ['downloading','Continue model setup'], ['downloadable','Download and enable model']]) {
      await call('Page.navigate', {url:'http://127.0.0.1:'+server.address().port+'/?nativeFixture='+state});
      await until(()=>evaluate('document.readyState === "complete" && !!document.querySelector("#question")'), 'Native fixture page missing');
      await until(()=>evaluate(`[...document.querySelectorAll('.chat-model button')].some(button=>button.textContent.trim()===${JSON.stringify(name)}&&!button.disabled)`), 'Native fixture control missing: '+name);
      const controls = await nativeControls(v.name);
      assert(controls.calls.availability > 0 && controls.calls.create === 0,
        'Availability must be checked automatically without creating a model.');
      assert.equal(await evaluate(`[...document.querySelectorAll('button')].filter(button=>button.textContent.trim()===${JSON.stringify(name)}).length`), 1,
        'Chrome model action must have one owner.');
      if (state === 'downloading') assert.equal(controls.progress?.value, null, 'Browser-owned download progress must stay indeterminate.');
      availability.push({state, ...controls});
    }
    await writeFile(join(output,'native-chat-'+v.name+'-before-enable.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate('[...document.querySelectorAll(".chat-model button")].find(button=>button.textContent.trim()==="Download and enable model").click(); true');
    await until(()=>evaluate('typeof window.__nativeSetupReady === "function"'), 'Native setup did not start');
    const starting = await nativeControls(v.name);
    assert(starting.buttons.some(button=>button.disabled&&button.name.startsWith('Starting')));
    assert(starting.buttons.some(button=>!button.disabled&&button.name==='Cancel loading'));
    assert.equal(starting.progress?.value, null);
    assert.equal(starting.calls.create, 1);
    await evaluate('window.__nativeSetupProgress(0.22); true');
    await until(()=>evaluate('document.querySelector(".chat-model progress")?.value===0.22'), 'Native download progress missing');
    const downloading = await nativeControls(v.name);
    assert.equal(downloading.progress?.label, 'Chrome LLM API model download');
    assert.equal(downloading.progress?.max, '1');
    assert(downloading.buttons.some(button=>button.disabled&&button.name.includes('Downloading')));
    assert(downloading.status.includes('22%'));
    await writeFile(join(output,'native-chat-'+v.name+'-loading.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate('window.__nativeSetupProgress(1); true');
    await until(()=>evaluate('[...document.querySelectorAll(".chat-model button")].some(button=>button.disabled&&button.textContent.includes("Preparing"))'), 'Completed download must wait for model preparation');
    const preparing = await nativeControls(v.name);
    assert.equal(preparing.progress?.value, '1');
    assert(preparing.buttons.some(button=>!button.disabled&&button.name==='Cancel loading'));
    await evaluate('window.__nativeSetupReady(); true');
    await until(()=>evaluate('document.querySelector(".live-label").textContent.includes("CHROME LLM · READY")'), 'Native fixture not ready');
    const ready = await nativeControls(v.name);
    assert(ready.buttons.some(button=>!button.disabled&&button.name==='Turn off model'));
    assert.equal(ready.progress, null);
    await writeFile(join(output,'native-chat-'+v.name+'-ready.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate('document.querySelector("#question").focus(); true');
    await call('Input.insertText', {text:fixtureProfile.faq[0].questions[0]}); await pressEnter();
    await until(()=>evaluate('!!window.__nativeFinish && document.querySelector(".model-searching")?.textContent.includes("Chrome LLM API is selecting")'), 'Exact FAQ did not reach native adapter');
    await evaluate('window.__nativeFinish(); true');
    await until(()=>evaluate('document.querySelector(".exchange .message-name")?.textContent.includes("AUTHORED PROFILE · CHECK SOURCES")'), 'Native draft not rendered');
    const draft = await evaluate(`(() => {const chat=document.querySelector('.chat-card');chat.scrollIntoView({behavior:'instant',block:'start'});return {text:chat.querySelector('.exchange .bubble').textContent,links:[...chat.querySelectorAll('.exchange .sources a')].map(a=>a.href),width:innerWidth,scrollWidth:document.documentElement.scrollWidth};})()`);
    assert(draft.text.includes(fixtureProfile.projects[0].summary));
    assert(!draft.text.includes(fixtureAnswer.text), 'Fabricated model claim surfaced as evidence-backed prose');
    assert(draft.text.includes('On-device model selected authored profile statements'));
    assert(draft.links.length>0); assert(draft.links.every(link=>fixtureProfile.evidence.some(e=>e.url===link)));
    assert(draft.scrollWidth<=v.width+2, 'Native chat overflows '+v.name);
    await writeFile(join(output,'native-chat-'+v.name+'.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate('window.__nativeFail=null; document.querySelector("#question").focus(); true');
    await call('Input.insertText',{text:'Tell me more about that.'}); await pressEnter();
    await until(()=>evaluate('typeof window.__nativeFail === "function"'), 'Follow-up did not reach native adapter');
    await evaluate('window.__nativeFail(); true');
    await until(()=>evaluate('document.querySelector(".chat-body").textContent.includes("Chrome LLM API could not reply. Showing the instant profile answer.")'), 'Native error silently swallowed');
    nativeChatFixture.results.push({viewport:v.name,availability,starting,downloading,preparing,ready,exactFaqUsesNative:true,draft,visibleErrorFallback:true});
  }
  await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:fixtureScript.identifier});

  const report = { browser, host: { platform: process.platform, arch: process.arch, cpuModel: cpus()[0]?.model ?? 'unknown', logicalCores: cpus().length, visibleRamGiB: Number((totalmem() / 1024 ** 3).toFixed(1)) }, method: 'headless Chromium; WebGPU disabled; emulated responsive viewports; baseline smoke checks both offline interaction and a new offline navigation without persisting chat; opt-in WASM evaluation reported separately', results, offlineNavigation, nativeChatFixture, ...(wasmEvaluation ? { wasmEvaluation: { sampleCount: wasmEvaluation.sampledCases, summary: wasmEvaluation.summary } } : {}) };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise(ok => child.once('exit', ok));
    child.kill('SIGKILL');
    await exited;
  }
  server.close();
  if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
