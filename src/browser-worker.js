// SPDX-License-Identifier: MIT
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } from '@bjorn3/browser_wasi_shim';

async function load(path) {
  const url = new URL(path, self.location.href);
  const response = await fetch(url, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('The bundled engine could not be loaded. Please reload and try again.');
  return new Uint8Array(await response.arrayBuffer());
}

self.onmessage = async ({ data }) => {
  try {
    const encoder = new TextEncoder();
    if (encoder.encode(data.html).length + encoder.encode(data.css).length > 500000) throw new Error('This document is too large for browser rendering.');
    const names = ['Inter-Variable.ttf', 'DMSerifDisplay-Regular.ttf', 'DMSerifDisplay-Italic.ttf', 'BebasNeue-Regular.ttf'];
    const [wasm, ...fonts] = await Promise.all([load('engine.wasm'), ...names.map(name => load(`fonts/${name}`))]);
    const files = new Map([['input.html', new File(encoder.encode(data.html))], ['style.css', new File(encoder.encode(data.css))], ...names.map((name, i) => [name, new File(fonts[i])])]);
    const root = new PreopenDirectory('.', files);
    let log = '';
    const collect = line => { log += String(line).slice(0, Math.max(0, 2000 - log.length)); };
    const wasi = new WASI(['fullbleed', '30', '0', 'reject', ...names], [], [new OpenFile(new File([])), ConsoleStdout.lineBuffered(collect), ConsoleStdout.lineBuffered(collect), root], { debug: false });
    const { instance } = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi.wasiImport });
    const status = wasi.start(instance);
    if (status !== 0) throw new Error(log || 'The PDF engine could not render this document.');
    const pdf = Uint8Array.from(files.get('document.pdf')?.data || []);
    const report = JSON.parse(new TextDecoder().decode(files.get('result.json')?.data));
    if (new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-') throw new Error('The engine returned an invalid PDF.');
    self.postMessage({ ok: true, pdf, pages: report.pages }, [pdf.buffer]);
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof WebAssembly.RuntimeError ? 'The document exceeded the browser rendering limit.' : error.message });
  }
};
