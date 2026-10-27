import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createWebServer } from './serve.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BENCHMARK_PLAYWRIGHT_MODULE || 'playwright');
const executablePath = process.env.BENCHMARK_BROWSER;
assert(executablePath, 'Set BENCHMARK_BROWSER to a Chromium browser executable');
const repetitions = Number(process.env.BENCHMARK_RUNS || 3);
assert(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 10);
const output = path.resolve(root, process.argv[2] || `benchmarks/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(output, { recursive: true });
const exec = promisify(execFile);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
};
const stats = values => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.length ? Math.max(...values) : null });
assert.equal(percentile([4, 1, 3, 2], .5), 2);
assert.equal(percentile([], .95), null);

async function sourceSnapshot() {
  const hash = createHash('sha256');
  for (const file of git('ls-files', '-z').split('\0').filter(Boolean).sort()) {
    hash.update(file + '\0');
    try { hash.update(await readFile(path.join(root, file))); } catch (error) { if (error.code !== 'ENOENT') throw error; hash.update('MISSING'); }
  }
  return { head: git('rev-parse', 'HEAD'), trackedWorkingTreeSha256: hash.digest('hex'), status: git('status', '--short') };
}

function instrument() {
  const b = window.__benchmark = { frames: [], gpu: [], picks: [], longTasks: [], memories: [], buffers: new Map(), contexts: [], pending: [], inRaf: false, activeQuery: null, disjoint: 0 };
  for (const name of ['instantiate', 'instantiateStreaming']) {
    const original = WebAssembly[name];
    if (!original) continue;
    WebAssembly[name] = async function (...args) {
      const result = await original.apply(this, args);
      const instance = result.instance || result;
      for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory && !b.memories.includes(value)) b.memories.push(value);
      return result;
    };
  }
  try { new PerformanceObserver(list => b.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true }); } catch {}
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const gl = getContext.apply(this, args);
    if (args[0] !== 'webgl2' || !gl || b.contexts.some(c => c.gl === gl)) return gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const context = { gl, ext, framebuffer: null, bindings: new Map(), renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
    b.contexts.push(context);
    for (const name of ['bindFramebuffer', 'bindBuffer', 'bufferData', 'deleteBuffer', 'clear', 'readPixels']) {
      const original = gl[name];
      gl[name] = function (...a) {
        if (name === 'bindFramebuffer' && a[0] === gl.FRAMEBUFFER) context.framebuffer = a[1];
        if (name === 'bindBuffer') context.bindings.set(a[0], a[1]);
        if (name === 'bufferData') {
          const data = a[1];
          b.buffers.set(context.bindings.get(a[0]), typeof data === 'number' ? data : data?.byteLength || 0);
        }
        if (name === 'deleteBuffer') b.buffers.delete(a[0]);
        if (name === 'clear') {
          if (b.inRaf && ext && !b.activeQuery) {
            const query = gl.createQuery();
            gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
            b.activeQuery = { query, context, start: performance.now() };
          }
          if (!context.framebuffer) b.currentFrame = performance.now();
        }
        const start = name === 'readPixels' ? performance.now() : 0;
        const result = original.apply(this, a);
        if (name === 'readPixels') b.picks.push({ start, duration: performance.now() - start, width: a[2], height: a[3] });
        return result;
      };
    }
    return gl;
  };
  b.drain = () => {
    for (let i = b.pending.length - 1; i >= 0; i--) {
      const item = b.pending[i], { gl, ext } = item.context;
      if (!gl.getQueryParameter(item.query, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) b.disjoint++;
      else b.gpu.push({ start: item.start, duration: gl.getQueryParameter(item.query, gl.QUERY_RESULT) / 1e6 });
      gl.deleteQuery(item.query); b.pending.splice(i, 1);
    }
  };
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = callback => raf.call(window, now => {
    const started = performance.now();
    b.inRaf = true; b.currentFrame = null;
    try { callback(now); }
    finally {
      if (b.activeQuery) {
        b.activeQuery.context.gl.endQuery(b.activeQuery.context.ext.TIME_ELAPSED_EXT);
        b.pending.push(b.activeQuery); b.activeQuery = null;
      }
      if (b.currentFrame !== null) b.frames.push({ start: b.currentFrame, submit: performance.now() - started });
      b.inRaf = false; b.drain();
    }
  });
}

const source = await sourceSnapshot();
await writeFile(path.join(output, 'working-tree.patch'), git('diff', '--binary') + '\n');
await writeFile(path.join(output, 'index.patch'), git('diff', '--cached', '--binary') + '\n');
const builtAssets = {};
for (const name of (await readdir(path.join(root, 'apps/web/dist/assets'))).sort()) builtAssets[name] = sha(await readFile(path.join(root, 'apps/web/dist/assets', name)));
const results = {
  schemaVersion: 1, startedAt: new Date().toISOString(), source, builtAssets,
  runnerSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  machine: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, physicalMemoryBytes: os.totalmem(), node: process.version, osVersion: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(), power: execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).trim() },
  protocol: { repetitions, viewport: { width: 1440, height: 900 }, dprs: [1, 2], headless: true, browserExecutable: executablePath, browserCache: 'disabled; a new isolated browser per trial; OS file cache not cleared', samplingIntervalMs: 100, frameLimit: 60, lighting: 'high', grid: true, defaultShadow: 'off', defaultSharpness: 'high', externalNetwork: 'blocked', memory: 'Sum of RSS for this dedicated browser process group, sampled every 100ms. Shared pages may be counted more than once; not physical footprint or dedicated VRAM. Blank-browser RSS is recorded per trial. Main V8 heap and main WASM memory are separate diagnostics, not total application memory.', gpu: 'EXT_disjoint_timer_query_webgl2 around each renderer RAF callback, from its first clear to callback end. Asynchronous results; includes all passes in that callback. No gl.finish. GPU utilization, power and total GPU memory are not measured.', frames: 'Viewer frames detected by clearing the default framebuffer. FPS counts actual renders, not RAF callbacks. Submit time is wall time in the renderer callback; it includes CPU/driver waits. Gaps include the 60 FPS cap.', instrumentation: 'RAF/clear/bind hooks, async GPU queries, long-task observer, startup buffer/WASM instrumentation and CDP/OS sampling. No per-draw wrapper. Compare only with the same runner and environment.' },
  trials: [],
};
const server = createWebServer();
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;

async function trial(dpr, repetition) {
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, ignoreDefaultArgs: ['--enable-unsafe-swiftshader'], args: ['--use-angle=metal'] });
  let timer, busy = false;
  const samples = [], samplingErrors = [];
  try {
    const browserCdp = await browser.newBrowserCDPSession();
    const info = await browserCdp.send('SystemInfo.getInfo');
    assert(!/swiftshader|software|llvmpipe/i.test(info.gpu.devices.map(d => d.deviceString).join(' ')), 'Hardware GPU required');
    const context = await browser.newContext({ viewport: results.protocol.viewport, deviceScaleFactor: dpr, reducedMotion: 'no-preference', colorScheme: 'light' });
    const blockedRequests = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      blockedRequests.push(url.href); return route.abort();
    });
    await context.addInitScript(instrument);
    await context.addInitScript(() => localStorage.setItem('anatomy-onboarding:v1', 'dismissed'));
    const page = await context.newPage();
    const errors = [], consoleMessages = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (['warning', 'error'].includes(m.type())) consoleMessages.push({ type: m.type(), text: m.text() }); });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const sample = async () => {
      const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
      const { stdout } = await exec('ps', ['-o', 'pid=,rss=', '-p', processInfo.map(p => p.id).join(',')]);
      const rss = new Map(stdout.trim().split('\n').filter(Boolean).map(line => line.trim().split(/\s+/).map(Number)));
      samples.push({ at: performance.now(), processes: processInfo.map(p => ({ ...p, rssBytes: (rss.get(p.id) || 0) * 1024 })) });
    };
    await sample();
    const blankRssBytes = samples.at(-1).processes.reduce((n, p) => n + p.rssBytes, 0);
    timer = setInterval(async () => { if (busy) return; busy = true; try { await sample(); } catch (e) { samplingErrors.push(e.message); } finally { busy = false; } }, 100);
    const phases = [];
    const memory = async () => {
      const heap = await cdp.send('Runtime.getHeapUsage');
      const app = await page.evaluate(() => {
        const b = window.__benchmark; b.drain();
        const canvas = document.querySelector('.model-canvas canvas');
        return { mainWasmLinearBytes: b.memories.reduce((n, m) => n + m.buffer.byteLength, 0), webglBufferBytes: [...b.buffers.values()].reduce((a, v) => a + v, 0), canvas: canvas && { width: canvas.width, height: canvas.height }, renderer: b.contexts.map(c => c.renderer), gpuTimerSupported: b.contexts.every(c => !!c.ext), status: document.querySelector('.model-status')?.textContent, settings: [...document.querySelectorAll('.settings-popover select')].map(s => s.value), domNodes: document.querySelectorAll('*').length };
      });
      return { heap, ...app };
    };
    async function phase(name, action) {
      const start = performance.now();
      const pageStart = name === 'startup' ? 0 : await page.evaluate(() => performance.now());
      await sample();
      await action();
      await sample();
      const end = performance.now(), pageEnd = await page.evaluate(() => performance.now());
      const row = { name, start, end, pageStart, pageEnd, memory: await memory() };
      phases.push(row); console.log(`DPR ${dpr} trial ${repetition}: ${name} ${(end - start).toFixed(0)}ms`);
    }
    await phase('startup', async () => {
      await page.goto(origin + '/anatomy', { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForSelector('.model-canvas[aria-busy="false"]', { timeout: 120000 });
    });
    assert.equal(await page.locator('.model-error').count(), 0);
    assert(phases[0].memory.mainWasmLinearBytes > 0, 'Capture main WASM memory');
    assert(phases[0].memory.webglBufferBytes > 200 * 1024 * 1024, 'Full anatomy geometry must be uploaded');
    assert(phases[0].memory.gpuTimerSupported, 'GPU timer query required');
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => /\.(glb|wasm)(\?|$)/.test(e.name)).map(e => ({ url: new URL(e.name).pathname, duration: e.duration, transferSize: e.transferSize, decodedBodySize: e.decodedBodySize })));
    assert.equal(resources.filter(r => r.url.endsWith('.glb')).length, 9);
    const canvas = page.locator('.model-canvas canvas');
    const focus = async () => { await canvas.focus(); };
    const hold = async (key, ms) => { await focus(); await page.keyboard.down(key); try { await delay(ms); } finally { await page.keyboard.up(key); } };
    const reset = async () => { await focus(); await page.keyboard.press('r'); await delay(1400); };
    const settings = async (name, value) => {
      const id = await page.locator('.settings-popover').getAttribute('id');
      const trigger = page.locator(`button[popovertarget="${id}"]:not([popovertargetaction="hide"])`);
      await trigger.click(); await page.locator(`.settings-popover select[id$="-${name}"]`).selectOption(value); await trigger.click(); await delay(700);
    };
    const explode = async value => {
      await page.locator('.explode-control input').evaluate((input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    };
    await delay(700);
    await phase('idle', () => delay(4000));
    await phase('rotate', () => hold('ArrowLeft', 6000));
    await reset();
    await phase('zoom', async () => { await hold('e', 2000); await hold('q', 2000); });
    await reset();
    await phase('explosion', async () => { for (const amount of [30, 60, 100]) { await explode(amount); await delay(2000); } });
    assert.equal(await page.locator('.explode-control output').textContent(), '100%');
    await phase('rotate_exploded', () => hold('ArrowLeft', 6000));
    await explode(0); await delay(2000); await reset();
    await phase('hover_picking', async () => {
      const box = await page.locator('.model-focus-frame').boundingBox();
      for (let i = 0; i < 32; i++) {
        await page.mouse.move(box.x + box.width * (.47 + .02 * (i % 4)), box.y + box.height * (.22 + .07 * (i % 8)));
        await delay(150);
      }
    });
    await page.mouse.move(0, 0); await delay(300);
    await settings('shadow', 'high');
    await phase('rotate_shadow_high', () => hold('ArrowLeft', 6000));
    await settings('shadow', 'off'); await settings('model', 'low'); await reset();
    await phase('rotate_half_resolution', () => hold('ArrowLeft', 6000));
    await settings('model', 'high'); await reset();
    await phase('idle_after_interactions', () => delay(4000));
    await page.screenshot({ path: path.join(output, `dpr-${dpr}-trial-${repetition}.png`) });
    const observed = await page.evaluate(() => {
      const b = window.__benchmark; b.drain();
      return { frames: b.frames, gpu: b.gpu, picks: b.picks, longTasks: b.longTasks, disjoint: b.disjoint, pendingGpuQueries: b.pending.length };
    });
    clearInterval(timer); timer = undefined;
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(await page.locator('.model-error').count(), 0, 'Viewer must remain healthy');
    assert.equal(samplingErrors.length, 0, samplingErrors.join('\n'));
    for (const p of phases) {
      const frames = observed.frames.filter(f => f.start >= p.pageStart && f.start <= p.pageEnd);
      const gpu = observed.gpu.filter(f => f.start >= p.pageStart && f.start <= p.pageEnd);
      const picks = observed.picks.filter(f => f.start >= p.pageStart && f.start <= p.pageEnd && f.width === 1 && f.height === 1);
      const selectedSamples = samples.filter(s => s.at >= p.start && s.at <= p.end);
      const rss = selectedSamples.map(s => s.processes.reduce((n, item) => n + item.rssBytes, 0));
      const first = selectedSamples[0], last = selectedSamples.at(-1);
      const cpuSeconds = first && last ? last.processes.reduce((n, item) => n + Math.max(0, item.cpuTime - (first.processes.find(f => f.id === item.id)?.cpuTime || 0)), 0) : null;
      const mainTasks = observed.longTasks.filter(t => t.start >= p.pageStart && t.start <= p.pageEnd);
      p.summary = { durationMs: p.end - p.start, frames: frames.length, actualRenderFps: frames.length / ((p.pageEnd - p.pageStart) / 1000), frameGapMs: stats(frames.slice(1).map((f, i) => f.start - frames[i].start)), submitMs: stats(frames.map(f => f.submit)), gpuMs: stats(gpu.map(f => f.duration)), readPixelsMs: stats(picks.map(f => f.duration)), rssBytes: stats(rss), cpuSeconds, cpuPercentOneCore: cpuSeconds === null ? null : cpuSeconds * 100000 / (last.at - first.at), longTasks: mainTasks.length, longTaskTotalMs: mainTasks.reduce((n, t) => n + t.duration, 0), samplingCount: selectedSamples.length };
      assert(selectedSamples.length >= 2, 'OS samples required');
      if (p.name.startsWith('rotate')) assert(frames.length > 10 && gpu.length > 0, 'Real renderer frames and GPU samples required');
      if (p.name === 'hover_picking') assert(picks.length >= 24, 'Hover must execute GPU picking');
    }
    return { dpr, repetition, browserVersion: browser.version(), gpu: { devices: info.gpu.devices, featureStatus: info.gpu.featureStatus }, blankRssBytes, phases, resources, observed, samples, errors, consoleMessages, blockedRequests, samplingErrors };
  } finally { if (timer) clearInterval(timer); await browser.close(); }
}

try {
  for (const dpr of [1, 2]) for (let repetition = 1; repetition <= repetitions; repetition++) {
    results.trials.push(await trial(dpr, repetition));
    await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  const after = await sourceSnapshot();
  assert.equal(after.trackedWorkingTreeSha256, source.trackedWorkingTreeSha256, 'Tracked working tree changed during benchmark');
  results.finishedAt = new Date().toISOString();
  const aggregated = [];
  for (const dpr of [1, 2]) for (const name of results.trials[0].phases.map(p => p.name)) {
    const rows = results.trials.filter(t => t.dpr === dpr).map(t => t.phases.find(p => p.name === name).summary);
    const median = key => percentile(rows.map(key).filter(v => v !== null), .5);
    aggregated.push({ dpr, phase: name, durationMs: median(r => r.durationMs), fps: median(r => r.actualRenderFps), p95FrameGapMs: median(r => r.frameGapMs.p95), p95SubmitMs: median(r => r.submitMs.p95), p95GpuMs: median(r => r.gpuMs.p95), peakRssMiB: median(r => r.rssBytes.max / 1048576), cpuPercentOneCore: median(r => r.cpuPercentOneCore), p95ReadPixelsMs: median(r => r.readPixelsMs.p95) });
  }
  results.aggregated = aggregated;
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  const fmt = value => value === null ? '—' : value.toFixed(2);
  const report = `# Human Atlas performance baseline\n\nCaptured ${results.startedAt}.\n\n- HEAD: \`${source.head}\`; working-tree SHA-256: \`${source.trackedWorkingTreeSha256}\`. Includes existing local changes; patches are saved beside this report.\n- ${results.machine.cpu}; ${results.machine.logicalCpus} logical CPUs; ${results.machine.physicalMemoryBytes / 1073741824} GiB RAM; macOS ${results.machine.osVersion}.\n- Chromium ${results.trials[0].browserVersion}, Brave, headless, Metal; 1440 × 900 CSS pixels; fresh browser/cache disabled for every trial; OS file cache is not cleared.\n- ${repetitions} trials per DPR. Table values are medians across trials; p95 values are calculated per trial first. Startup duration includes reconstruction until aria-busy=false.\n- All 9 anatomy systems, high lighting, grid on, 60 FPS cap. Shadows off and full sharpness except explicitly named phases. Hover is a fixed 32-point path with 150 ms pauses. Explosion traverses 30%, 60%, 100%.\n\n| DPR | Phase | Duration ms | Render FPS | p95 frame gap ms | p95 submit ms | p95 GPU ms | Peak group RSS MiB | CPU % of one core | p95 readPixels ms |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${aggregated.map(r => `| ${r.dpr} | ${r.phase} | ${fmt(r.durationMs)} | ${fmt(r.fps)} | ${fmt(r.p95FrameGapMs)} | ${fmt(r.p95SubmitMs)} | ${fmt(r.p95GpuMs)} | ${fmt(r.peakRssMiB)} | ${fmt(r.cpuPercentOneCore)} | ${fmt(r.p95ReadPixelsMs)} |`).join('\n')}\n\n## Interpretation and limits\n\n- Idle rendering can correctly be 0 FPS: the viewer draws on demand. Render FPS during discrete hover/explosion events is not a sustained throughput score.\n- RSS is the sum for this isolated browser group, including browser, renderer/worker, GPU and service processes. Shared pages can be counted more than once; this is not physical memory footprint. CPU 100% means one core; GPU-process CPU time is not GPU utilization. Peak values are sampled, not exact allocation peaks.\n- GPU timer queries measure GPU elapsed time inside renderer callbacks. Submit wall time includes CPU/driver waits. Neither number should be added to the other.\n- Main-page heap, WASM linear capacity, tracked WebGL buffer bytes, per-process RSS/CPU samples, per-frame timings and browser messages are in results.json. Main heap excludes workers and is not total RAM. WebGL buffer bytes exclude render targets and driver overhead.\n- Instrumentation adds overhead. Reuse this runner, browser version, viewport, DPR, power state and build mode for comparisons. External network is blocked; Wikipedia content, Safari, Tauri, battery/thermal profiling and lower-end machines are not covered.\n- Screenshots verify final anatomy visibility. Working tree and built assets are fingerprinted. No production behavior was optimized.\n`;
  await writeFile(path.join(output, 'report.md'), report);
  console.log(JSON.stringify({ output, trials: results.trials.length, aggregated }, null, 2));
} catch (error) {
  results.failure = { message: error.message, stack: error.stack };
  await writeFile(path.join(output, 'failed-results.json'), JSON.stringify(results, null, 2) + '\n');
  throw error;
} finally { await new Promise(resolve => server.close(resolve)); }
