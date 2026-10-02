// SPDX-License-Identifier: GPL-2.0-or-later
import { buildDocument } from './documents.js';

const root = document.querySelector('#fullbleed-commerce');
const config = JSON.parse(root.dataset.config);
const status = root.querySelector('[data-status]');
const preview = root.querySelector('[data-preview]');
const form = root.querySelector('form');
const runButton = root.querySelector('[data-render]');
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

form.addEventListener('submit', async event => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  runButton.disabled = true;
  clearPreview();
  try {
    report('Loading your order…');
    const options = getOptions();
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

// Extension point for separate workflow add-ons. The base includes no paid-only code.
window.FullbleedCommerce = { root, form, config, loadOrder, getOptions, buildDocument, render, report, download, clearPreview };
