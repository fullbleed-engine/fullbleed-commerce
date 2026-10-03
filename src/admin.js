// SPDX-License-Identifier: GPL-2.0-or-later
import { buildDocument, starterTemplate } from './documents.js';
import { validateTemplate } from './templates.js';

const root = document.querySelector('#fullbleed-commerce');
const config = JSON.parse(root.dataset.config);
const status = root.querySelector('[data-status]');
const preview = root.querySelector('[data-preview]');
const form = root.querySelector('form');
const runButton = root.querySelector('[data-render]');
const editButton = root.querySelector('[data-edit-template]');
const pendingExtensions = new Set(config.extensions || []);
let objectUrl;

function clearPreview() {
  preview.hidden = true;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = undefined;
  preview.removeAttribute('href');
}
form.addEventListener('input', clearPreview);

function report(message, error = false) {
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

function render(document) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`${config.assets}worker.js`);
    const finish = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => finish(new Error('Rendering took too long. Try a smaller order.')), 30000);
    worker.onerror = () => finish(new Error('The PDF worker could not start. Please reload and try again.'));
    worker.onmessage = ({ data }) => data.ok ? finish(null, data) : finish(new Error(data.error));
    worker.postMessage({ html: document.html, css: document.css });
  });
}

function download(bytes, type, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function loadOrder(id) {
  if (!/^[1-9]\d{0,12}$/.test(id)) throw new Error('Enter a valid numeric order ID from the Orders screen.');
  const response = await fetch(`${config.endpoint}/${encodeURIComponent(id)}`, { credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': config.nonce } });
  const order = await response.json();
  if (!response.ok) throw new Error(order.message || 'This order could not be loaded.');
  return order;
}

function getOptions() {
  const theme = config.themes.find(theme => theme.value === form.elements.theme.value);
  if (!theme) throw new Error('This design is unavailable.');
  return { kind: form.elements.kind.value, design: theme.design, paper: form.elements.paper.value, accent: form.elements.accent.value, footer: form.elements.footer.value };
}

async function templateRequest(kind, input) {
  if (!config.templatesEndpoint) return { template: null, revision: '' };
  const response = await fetch(`${config.templatesEndpoint}/${kind}`, { method: input ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-WP-Nonce': config.nonce, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || 'The template could not be loaded.');
  return { ...body, template: body.template ? validateTemplate(body.template, kind) : null };
}

async function getDocumentOptions() {
  const options = getOptions();
  const { template } = await templateRequest(options.kind);
  return { ...options, template };
}

let editorInstance;
let editorScript;
editButton?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const editorStatus = root.querySelector('[data-template-status]');
  if (editorInstance?.hasUnsavedChanges() && !window.confirm('Discard the unsaved template edits and open the selected document?')) return;
  button.disabled = true;
  try {
    const options = getOptions();
    const saved = await templateRequest(options.kind);
    let revision = saved.revision;
    if (!window.FullbleedTemplateEditor) {
      editorScript ||= new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = `${config.assets}editor.js`; script.onload = resolve; script.onerror = () => { editorScript = undefined; reject(new Error('The template editor could not load. Please retry.')); }; document.head.append(script); });
      await editorScript;
    }
    editorInstance?.destroy();
    editorInstance = window.FullbleedTemplateEditor.mount(root.querySelector('[data-template-editor]'), {
      kind: options.kind, initial: saved.template, defaults: starterTemplate(options), fontBase: `${config.assets}fonts/`,
      onSave: async template => { const result = await templateRequest(options.kind, { template, revision }); revision = result.revision; clearPreview(); },
      onReset: async () => { const result = await templateRequest(options.kind, { template: null, revision }); revision = result.revision; clearPreview(); },
      onPreview: async template => {
        const id = String(form.elements.order_ids.value).trim().split(',')[0];
        const order = await loadOrder(id);
        const result = await render(buildDocument(order, { ...options, template }));
        return new Blob([result.pdf], { type: 'application/pdf' });
      },
    });
    editorStatus.textContent = `Editing ${options.kind === 'packing-slip' ? 'packing slip' : 'order summary'}. Preview uses the first order ID above.`;
  } catch (error) { editorStatus.textContent = error.message; }
  finally { button.disabled = false; }
});

form.addEventListener('submit', async event => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  if (pendingExtensions.size) return;
  runButton.disabled = true;
  clearPreview();
  try {
    report('Loading your order…');
    const options = await getDocumentOptions();
    const order = await loadOrder(String(form.elements.order_ids.value).trim());
    const document = buildDocument(order, options);
    report('Rendering your PDF…');
    const result = await render(document);
    objectUrl = URL.createObjectURL(new Blob([result.pdf], { type: 'application/pdf' }));
    preview.href = objectUrl;
    preview.download = document.filename;
    preview.hidden = false;
    report(`Ready. ${result.pages} page(s). Your PDF was generated in this browser.`);
  } catch (error) {
    report(error.message || 'The document could not be generated.', true);
  } finally {
    runButton.disabled = false;
  }
});

function enableControls() {
  if (pendingExtensions.size) return;
  runButton.disabled = false;
  if (editButton) editButton.disabled = false;
  report('Choose an order and generate a PDF.');
}

// Extension point for separate workflow add-ons. The base includes no paid-only code.
// Keep the server-rendered controls disabled until every declared extension has
// installed its designs and event handlers. A slow script must not submit the
// native form or silently render the wrong design.
window.FullbleedCommerce = { root, form, config, loadOrder, getOptions, getDocumentOptions, buildDocument, render, report, download, clearPreview,
  registerExtension(name) { pendingExtensions.delete(name); enableControls(); },
};
enableControls();
