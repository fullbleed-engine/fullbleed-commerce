// SPDX-License-Identifier: GPL-2.0-or-later
import { zipSync } from 'fflate';
import { designs } from './designs.js';
const api = window.FullbleedCommerce;
if (api) {
  for (const theme of api.config.themes) if (designs[theme.value]) theme.design = designs[theme.value];
  api.form.addEventListener('submit', async event => {
    const ids = [...new Set(String(api.form.elements.order_ids.value).split(/[\s,]+/).filter(Boolean))];
    if (ids.length <= 1) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const button = api.root.querySelector('[data-render]');
    button.disabled = true;
    api.clearPreview();
    try {
      if (ids.length > 25 || ids.some(id => !/^[1-9]\d{0,12}$/.test(id))) throw new Error('Enter up to 25 valid numeric order IDs.');
    const options = await api.getDocumentOptions();
      const files = {};
      let totalBytes = 0;
      for (let i = 0; i < ids.length; i++) {
        api.report(`Rendering order ${i + 1} of ${ids.length}…`);
        const order = await api.loadOrder(ids[i]);
        const document = api.buildDocument(order, options);
        const result = await api.render(document);
        totalBytes += result.pdf.byteLength;
        if (totalBytes > 50 * 1024 * 1024) throw new Error('This batch exceeds 50 MiB. Export fewer orders at a time.');
        files[`${ids[i]}-${document.filename}`] = result.pdf;
      }
      api.download(zipSync(files), 'application/zip', 'fullbleed-orders.zip');
      api.report(`Downloaded ${ids.length} PDFs in one ZIP. Your documents were generated in this browser.`);
    } catch (error) {
      api.report(error.message || 'The batch could not be completed.', true);
    } finally {
      button.disabled = false;
    }
  }, { capture: true });
}
