import { createServer } from 'node:http';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, sep, extname } from 'node:path';
import assert from 'node:assert/strict';

const dist = resolve('dist');
const output = resolve('artifacts/browser-smoke');
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const chrome = [process.env.CHROME_PATH, 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean).find(bin => spawnSync(bin, ['--version']).status === 0);
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
  ws.addEventListener('message', event => {
    const data = JSON.parse(String(event.data));
    if (!data.id || !pending.has(data.id)) return;
    const next = pending.get(data.id); pending.delete(data.id); clearTimeout(next.timer);
    data.error ? next.reject(Error(data.error.message)) : next.resolve(data.result ?? {});
  });
  return { ws, call(method, params = {}) {
    return new Promise((ok, fail) => {
      const id = ++serial;
      const timer = setTimeout(() => { pending.delete(id); fail(Error(method + ' timed out')); }, 15000);
      pending.set(id, { resolve: ok, reject: fail, timer });
      ws.send(JSON.stringify({ id, method, params }));
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
  const { ws, call } = await connect(target.webSocketDebuggerUrl);
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
  for (const v of [{ name: 'desktop', width: 1280, height: 800, mobile: false }, { name: 'mobile', width: 390, height: 844, mobile: true }]) {
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
        developerLast: !!dev && !!exp && !!(exp.compareDocumentPosition(dev) & Node.DOCUMENT_POSITION_FOLLOWING),
        developerCollapsed: !document.querySelector('.developer-tools')?.open,
        chatFirst: !!chat && !!profile && chat.getBoundingClientRect().top <= profile.getBoundingClientRect().top + 1,
        formLabeled: !!document.querySelector('label[for="question"]'),
        sendLabeled: document.querySelector('.composer button')?.getAttribute('aria-label') === 'Send question'
      };
    })()`);
    assert.match(layout.heading, /Ask about the work/i);
    assert(layout.developerLast && layout.developerCollapsed && layout.formLabeled && layout.sendLabeled);
    assert(layout.developerHeight > 0 && layout.developerTop < layout.scrollHeight, 'Developer footer must actually be visible in page layout.');
    assert(layout.width <= v.width + 2 && layout.scrollWidth <= layout.width + 2, v.name + ' has horizontal overflow or incorrect viewport scale.');
    if (v.mobile) assert(layout.chatFirst, 'Mobile should show recruiter chat before sidebar.');
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
    await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await evaluate('document.querySelector(".hero-example").click(); true');
    await until(() => evaluate('document.querySelectorAll(".exchange .sources a").length > 0'), 'Offline evidence-backed answer failed on ' + v.name);
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
    results.push({ viewport: v.name, keyboardSkipLink: skipLink, ...layout, ...(mobileUsability ? { mobileUsability } : {}), ...keyboard, keyboardSubmitted: true, keyboardDeveloperDisclosure: true, screenshotHeight, evidenceLinks: await evaluate('document.querySelectorAll(".exchange .sources a").length') });
  }

  // Opt-in REAL model evaluation. This path downloads the actual quantized WASM
  // model, so regular smoke CI remains deterministic, offline, and fast.
  // Example: RUN_WASM_EVAL=1 WASM_EVAL_PER_CATEGORY=8 node scripts/browser-smoke.mjs
  let wasmEvaluation = null;
  if (process.env.RUN_WASM_EVAL === '1') {
    const sample = JSON.parse(await readFile('tests/fixtures/sample-profile.json', 'utf8'));
    const corpus = JSON.parse(await readFile('tests/fixtures/retrieval-corpus.json', 'utf8'));
    const perCategory = Number(process.env.WASM_EVAL_PER_CATEGORY ?? 8);
    assert(Number.isSafeInteger(perCategory) && perCategory >= 1 && perCategory <= 100, 'WASM_EVAL_PER_CATEGORY must be 1-100.');
    assert.equal(corpus.version, 1);
    const rows = ['paraphrases', 'unrelated', 'sensitive', 'ambiguous']
      .flatMap(category => corpus[category].slice(0, perCategory).map(row => ({ category, ...row })));
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
      model: 'Xenova/all-MiniLM-L6-v2', modelRevision: '751bff37182d3f1213fa05d7196b954e230abad9',
      perCategory, totalCorpusCases: Object.values(corpus).filter(Array.isArray).reduce((count, arr) => count + arr.length, 0),
      sampledCases: rows.length, results: [], limitations: 'Chromium desktop CI runner only; not a mobile device or WebGPU test. No remote-model download byte measurement. UI wall time includes rendering; worker timings are separately displayed. No validation that linked evidence substantiates claims.' };
    try {
      await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      const navigation = await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
      if (navigation.errorText) throw new Error(navigation.errorText);
      await until(() => evaluate('document.readyState === "complete" && !!document.querySelector(".developer-tools")'), 'Benchmark page did not load.');
      const pressed = await evaluate('(() => {document.querySelector(".developer-tools").open = true; document.querySelector(".model-panel").open = true; const button = [...document.querySelectorAll(".model-content button")].find(b => b.textContent.includes("Enable WASM search")); if (!button) return false; button.click(); return true;})()');
      assert(pressed, 'Could not opt into WASM search.');
      const beganAt = Date.now();
      const status = await waitModel(async () => {
        const label = await evaluate('document.querySelectorAll(".model-content .model-status")[1]?.textContent ?? ""');
        return label.includes('Enabled on this device') ? 'ready' : label.includes('Could not start') ? 'error: ' + label : null;
      }, 180_000, 'Real WASM model failed to become ready within 180 seconds.');
      assert.equal(status, 'ready', 'Actual WASM startup failed: ' + status);
      benchmarkReport.modelReadyWallMs = Date.now() - beganAt;
      benchmarkReport.userAgent = await evaluate('navigator.userAgent');

      for (const row of rows) {
        const count = await evaluate('document.querySelectorAll(".exchange").length');
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
        const matched = sample.faq.find(faq => finalText.includes('Related information from the public profile: ' + faq.answer));
        const evidenceLinks = await evaluate('document.querySelectorAll(".exchange:last-child .sources a").length');
        if (matched) assert(evidenceLinks > 0 && finalText.includes('I can’t verify the specific claim'), 'A WASM FAQ selection must retain sources and a non-verification warning.');
        const result = { category: row.category, question: row.question,
          ...(row.faqId ? { expectedFaqId: row.faqId } : {}),
          wasmAttempt: traced.started, returnedFaqId: matched?.id ?? null,
          privateRefusal: finalText.includes('I can only discuss information the candidate chose to publish'), evidenceLinks,
          elapsedUiMs: Number((performance.now() - startedAt).toFixed(1)) };
        benchmarkReport.results.push(result);
        if (row.category === 'sensitive') assert(!result.wasmAttempt && result.privateRefusal, 'Sensitive query reached the model or was not refused: ' + row.question);
      }
      benchmarkReport.summary = Object.fromEntries(['paraphrases','unrelated','sensitive','ambiguous'].map(category => {
        const subset = benchmarkReport.results.filter(row => row.category === category);
        const actual = subset.filter(row => row.wasmAttempt);
        return [category, { checked: subset.length, modelAttempts: actual.length,
          selectedFaqs: actual.filter(row => row.returnedFaqId !== null).length,
          correctSelections: actual.filter(row => row.returnedFaqId === row.expectedFaqId && !!row.expectedFaqId).length }];
      }));
      const paraphrase = benchmarkReport.summary.paraphrases;
      const unrelated = benchmarkReport.summary.unrelated;
      benchmarkReport.correctFaqRate = paraphrase.modelAttempts ? paraphrase.correctSelections / paraphrase.modelAttempts : null;
      benchmarkReport.unrelatedFalseRelatedRate = unrelated.modelAttempts ? unrelated.selectedFaqs / unrelated.modelAttempts : null;
      benchmarkReport.summaryNote = 'Rates use only actual WASM attempts; null means no measurable sample. Absent a model calibration gate, these are observational and may show unsafe relevance.';
      benchmarkReport.performancePanel = await evaluate('Object.fromEntries([...document.querySelectorAll(".performance-panel dl div")].map(row => [row.querySelector("dt")?.textContent ?? "", row.querySelector("dd")?.textContent ?? ""]))');
      wasmEvaluation = benchmarkReport;
    } catch (error) {
      benchmarkReport.error = String(error);
      await writeFile(join(output, 'wasm-relevance.json'), JSON.stringify(benchmarkReport, null, 2) + '\n');
      throw error;
    }
    await writeFile(join(output, 'wasm-relevance.json'), JSON.stringify(benchmarkReport, null, 2) + '\n');
    console.log('Real WASM evaluation summary: ' + JSON.stringify({ summary: benchmarkReport.summary, performancePanel: benchmarkReport.performancePanel }, null, 2));
  }
  const report = { browser, method: 'headless Chromium; WebGPU disabled; no local model enabled; network offline after initial load', results, ...(wasmEvaluation ? { wasmEvaluation: { sampleCount: wasmEvaluation.sampledCases, summary: wasmEvaluation.summary } } : {}) };
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
