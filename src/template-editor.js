// SPDX-License-Identifier: GPL-2.0-or-later
import grapesjs from 'grapesjs';
import { TEMPLATE_SCHEMA, validateTemplate, templateFields } from './templates.js';

// Both integrations use this editor. Only templates are saved; order data and
// PDF previews never enter GrapesJS or its storage manager.
export function mountTemplateEditor(host, { kind, initial, defaults, fontBase, onSave, onReset, onPreview }) {
  let current = validateTemplate(initial || defaults, kind);
  let editor;
  let mode = 'source';
  let dirty = false;
  let editRevision = 0;
  let loading = false;
  let baseCss = current.css;
  let previewUrl;
  let destroyed = false;
  let bundledFonts;
  function loadBundledFonts() {
    if (!fontBase) return Promise.resolve([]);
    // Fetch in the host document: an editor iframe is not necessarily a
    // service-worker client (notably inside WordPress Playground). Font URLs
    // requested by that iframe can hit the real server and return 404.
    bundledFonts ||= Promise.all([
      ['Inter', 'Inter-Variable.ttf', { weight: '100 900' }],
      ['DM Serif Display', 'DMSerifDisplay-Regular.ttf', {}],
      ['DM Serif Display', 'DMSerifDisplay-Italic.ttf', { style: 'italic' }],
      ['Bebas Neue', 'BebasNeue-Regular.ttf', {}],
    ].map(async ([family, file, descriptors]) => {
      const url = new URL(file, new URL(fontBase, window.location.href));
      if (url.origin !== window.location.origin) throw new Error('Editor fonts must come from this site.');
      const response = await fetch(url);
      if (!response.ok) throw new Error('A bundled editor font could not load.');
      return { family, descriptors, bytes: await response.arrayBuffer() };
    })).catch(error => { bundledFonts = undefined; throw error; });
    return bundledFonts;
  }
  host.classList.add('fb-editor');
  host.innerHTML = `<div class="fb-editor-toolbar"><div class="fb-editor-modes" role="group" aria-label="Editing mode"><button type="button" data-mode="visual">Visual editor</button><button type="button" data-mode="source">HTML / CSS</button></div><div class="fb-editor-actions"><button type="button" data-action="preview">Preview PDF</button><button type="button" class="fb-editor-primary" data-action="save">Save template</button></div></div>
<p class="fb-editor-status" data-message role="status" aria-live="polite"></p>
<p class="fb-editor-hint">Drag blocks, double-click text, and style selected elements. Fields fill from each order; repeat blocks expand into all items. The PDF preview shows final pagination and font rendering.</p>
<div data-visual hidden class="fb-visual-layout"><aside><h3>Add a block</h3><div data-blocks></div><details open><summary>Layers</summary><div data-layers></div></details></aside><div data-canvas></div><aside><h3>Style selection</h3><div data-selectors></div><div data-styles></div></aside></div>
<div data-source class="fb-source-layout"><label>HTML<textarea data-html spellcheck="false" aria-label="Template HTML"></textarea></label><label>CSS<textarea data-css spellcheck="false" aria-label="Template CSS"></textarea></label></div>
<div class="fb-editor-tools"><label>Insert order field <select data-field aria-label="Order field"></select></label><button type="button" data-action="field">Insert field</button><label class="fb-file-button">Add logo<input type="file" data-logo accept="image/png,image/jpeg"></label><button type="button" data-action="undo">Undo</button><button type="button" data-action="redo">Redo</button><button type="button" data-action="export">Export template</button><label class="fb-file-button">Import template<input type="file" data-import accept="application/json,.json"></label><button type="button" data-action="defaults">Load starter into editor</button><button type="button" data-action="reset">Use built-in design</button></div>
<details class="fb-editor-help"><summary>Template fields and print CSS</summary><p>Use <code>{{order.number}}</code>, <code>{{seller.name}}</code>, <code>{{shipping.address}}</code> or a field from the menu. Addresses use <code>white-space: pre-line</code>. Repeat a row with <code>data-fb-repeat="items"</code> and <code>{{item.name}}</code>, <code>{{item.sku}}</code>, <code>{{item.quantity}}</code>${kind === 'packing-slip' ? '' : ', <code>{{item.total}}</code>'}. ${kind === 'packing-slip' ? '' : 'Repeat totals with <code>data-fb-repeat="totals"</code>, <code>{{total.label}}</code> and <code>{{total.amount}}</code>.'}</p><p>Set paper and margins with <code>@page { size: A4; margin: 15mm; }</code>. Fonts: Inter, DM Serif Display, Bebas Neue. Saved templates control their own layout, paper and colors. Paste static HTML/CSS; scripts, remote resources and custom font URLs are unavailable. Upload a PNG or JPEG logo under 180 KB.</p><p>Switching to Visual preserves your CSS and adds visual style overrides after it. Export a template to keep a portable backup. Templates should contain store copy and fields, never pasted customer details.</p></details>
<div data-pdf hidden class="fb-editor-preview"><a data-pdf-link target="_blank" rel="noopener">Open PDF preview</a><iframe title="Fullbleed PDF preview" data-pdf-frame></iframe></div>`;
  const query = selector => host.querySelector(selector);
  const html = query('[data-html]');
  const css = query('[data-css]');
  const message = query('[data-message]');
  const field = query('[data-field]');
  const availableFields = templateFields.filter(name => kind !== 'packing-slip' || !name.startsWith('customer.'));
  for (const name of availableFields) { const option = document.createElement('option'); option.value = name; option.textContent = name; field.append(option); }
  function report(text, error = false) { message.textContent = text; message.classList.toggle('is-error', error); }
  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = undefined;
    query('[data-pdf]').hidden = true;
    query('[data-pdf-frame]').removeAttribute('src');
    query('[data-pdf-link]').removeAttribute('href');
  }
  function changed({ visual = false } = {}) { if (loading && visual) return; dirty = true; editRevision++; clearPreview(); report('Unsaved changes. Preview, then save to use this template for future documents.'); }
  function setSource(template) { html.value = template.html; css.value = template.css; }
  function getTemplate() {
    if (mode === 'source') return validateTemplate({ schema: TEMPLATE_SCHEMA, html: html.value, css: css.value }, kind);
    return validateTemplate({ schema: TEMPLATE_SCHEMA, html: editor.getWrapper().components().map(component => component.toHTML()).join(''), css: baseCss + '\n' + editor.getCss({ keepUnusedStyles: true }) }, kind);
  }
  function buildVisual(template) {
    editor?.destroy();
    loading = true;
    baseCss = template.css;
    const blocks = [
      { id: 'heading', label: 'Heading', content: '<h2>Make it yours.</h2>' },
      { id: 'text', label: 'Text', content: '<p>Double-click to write your message.</p>' },
      { id: 'columns', label: 'Two columns', content: '<div style="display:flex;gap:18pt"><div style="width:50%"><p>First column</p></div><div style="width:50%"><p>Second column</p></div></div>' },
      { id: 'rule', label: 'Divider', content: '<hr style="border:0;border-top:1pt solid #203a32;margin:18pt 0">' },
      { id: 'address', label: 'Shipping address', content: '<div><strong>{{shipping.name}}</strong><p style="white-space:pre-line">{{shipping.address}}</p></div>' },
      { id: 'items', label: 'Order items', content: `<table class="items"><thead><tr><th>Description</th><th>Qty</th>${kind === 'packing-slip' ? '' : '<th>Subtotal</th>'}</tr></thead><tbody><tr data-fb-repeat="items"><td>{{item.name}}<br><small>{{item.sku}}</small></td><td>{{item.quantity}}</td>${kind === 'packing-slip' ? '' : '<td>{{item.total}}</td>'}</tr></tbody></table>` },
      ...(kind === 'packing-slip' ? [] : [{ id: 'totals', label: 'Order totals', content: '<div class="totals"><div class="total-row" data-fb-repeat="totals"><span>{{total.label}}</span><strong>{{total.amount}}</strong></div></div>' }]),
    ];
    editor = grapesjs.init({
      container: query('[data-canvas]'), height: '660px', width: '100%', fromElement: false,
      storageManager: false, telemetry: false, noticeOnUnload: false, jsInHtml: false, nativeDnD: false,
      components: template.html, style: '', protectedCss: '', keepUnusedStyles: true,
      parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false } },
      panels: { defaults: [] }, blockManager: { appendTo: query('[data-blocks]'), blocks },
      layerManager: { appendTo: query('[data-layers]') }, selectorManager: { componentFirst: true },
      assetManager: { upload: false, embedAsBase64: false, showUrlInput: false, assets: [] },
      deviceManager: { devices: [{ id: 'paper', name: 'Paper', width: '794px' }] },
      canvas: { scripts: [], styles: [], allowExternalDrop: false, frameStyle: `body { margin: 0; padding: 40px; } ${baseCss}` },
      styleManager: { appendTo: query('[data-styles]'), sectors: [
        { name: 'Typography', open: true, buildProps: ['font-family', 'font-size', 'font-weight', 'color', 'line-height', 'letter-spacing', 'text-align'], properties: [{ property: 'font-family', type: 'select', options: [{ id: 'Inter', label: 'Inter' }, { id: 'DM Serif Display', label: 'DM Serif Display' }, { id: 'Bebas Neue', label: 'Bebas Neue' }] }] },
        { name: 'Space and layout', open: false, buildProps: ['display', 'width', 'height', 'margin', 'padding', 'justify-content', 'align-items', 'gap'] },
        { name: 'Color and borders', open: false, buildProps: ['background-color', 'border', 'border-radius'] },
      ] },
    });
    editor.getWrapper().set({ stylable: false, droppable: true });
    const mountedEditor = editor;
    editor.on('canvas:frame:load:head', ({ window: frame }) => {
      loadBundledFonts().then(async fonts => {
        if (destroyed || mountedEditor !== editor) return;
        const faces = fonts.map(({ family, descriptors, bytes }) => new frame.FontFace(family, bytes, descriptors));
        await Promise.all(faces.map(face => face.load()));
        if (destroyed || mountedEditor !== editor) return;
        for (const face of faces) frame.document.fonts.add(face);
      }).catch(() => {
        if (!destroyed && mountedEditor === editor) report('Editor fonts could not load. Reopen the editor to retry; use Preview PDF to check the final document.', true);
      });
      frame.document.addEventListener('paste', event => {
        event.preventDefault();
        frame.document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
      }, true);
      frame.document.addEventListener('drop', event => event.preventDefault(), true);
    });
    editor.on('load', () => {
      loading = false;
      const width = query('[data-canvas]').clientWidth;
      if (width > 0) editor.Canvas.setZoom(Math.max(30, Math.min(100, Math.floor((width - 24) / 794 * 100))));
    });
    editor.on('update', () => changed({ visual: true }));
  }
  function setMode(next) {
    if (next === mode && editor) return;
    current = getTemplate();
    if (next === 'visual') { query('[data-visual]').hidden = false; query('[data-source]').hidden = true; buildVisual(current); }
    else { setSource(current); query('[data-source]').hidden = false; query('[data-visual]').hidden = true; }
    mode = next;
    for (const button of host.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    for (const action of ['undo', 'redo']) query(`[data-action="${action}"]`).disabled = mode !== 'visual';
  }
  function insert(content) {
    if (mode === 'visual') {
      const selected = editor.getSelected();
      const target = selected && selected.get('droppable') && !['img', 'hr', 'br'].includes(selected.get('tagName')) ? selected : editor.getWrapper();
      target.append(content);
    } else { const start = html.selectionStart; html.setRangeText(content, start, html.selectionEnd, 'end'); html.focus(); }
    changed();
  }
  function download(content, type, name) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function action(name) {
    if (name === 'field') return insert(`<span>{{${field.value}}}</span>`);
    if (name === 'undo') return editor.UndoManager.undo();
    if (name === 'redo') return editor.UndoManager.redo();
    if (name === 'defaults') {
      current = validateTemplate(defaults, kind); setSource(current);
      if (mode === 'visual') buildVisual(current);
      changed(); return;
    }
    if (name === 'export') return download(JSON.stringify({ ...getTemplate(), kind }, null, 2), 'application/json', `fullbleed-${kind}-template.json`);
    if (name === 'save') {
      const template = getTemplate(); const savingRevision = editRevision; await onSave(template);
      if (editRevision === savingRevision) { dirty = false; report('Saved. New documents of this type now use your template.'); }
      else report('The earlier version was saved. Your latest edits are still unsaved.');
      return;
    }
    if (name === 'reset') {
      await onReset(); current = validateTemplate(defaults, kind); setSource(current);
      if (mode === 'visual') buildVisual(current);
      dirty = false; clearPreview(); report('Built-in design restored. Your starter is ready to customize again.'); return;
    }
    if (name === 'preview') {
      clearPreview(); report('Rendering the PDF preview…');
      const renderingRevision = editRevision;
      const blob = await onPreview(getTemplate());
      if (destroyed || renderingRevision !== editRevision) return;
      if (!(blob instanceof Blob) || blob.size > 50 * 1024 * 1024 || (await blob.slice(0, 5).text()) !== '%PDF-') throw new Error('The preview did not return a complete PDF.');
      previewUrl = URL.createObjectURL(blob);
      query('[data-pdf-link]').href = previewUrl; query('[data-pdf-frame]').src = previewUrl;
      query('[data-pdf]').hidden = false;
      report('Preview ready. Save the template when you are happy with the result.');
    }
  }
  host.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    try {
      if (button.dataset.mode) return setMode(button.dataset.mode);
      if (!button.dataset.action) return;
      button.disabled = true;
      await action(button.dataset.action);
    } catch (error) { report(error.message || 'The template could not be updated.', true); }
    finally { button.disabled = ['undo', 'redo'].includes(button.dataset.action) && mode !== 'visual'; }
  });
  html.addEventListener('input', changed); css.addEventListener('input', changed);
  query('[data-import]').addEventListener('change', async event => {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      if (file.size > 786432) throw new Error('Choose a template file under 768 KB.');
      const imported = JSON.parse(await file.text());
      if (imported.kind && imported.kind !== kind) throw new Error('This template is for a different document type.');
      current = validateTemplate(imported, kind); setSource(current);
      if (mode === 'visual') buildVisual(current); changed();
    } catch (error) { report(error.message, true); }
    finally { event.target.value = ''; }
  });
  query('[data-logo]').addEventListener('change', async event => {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 180000) throw new Error('Choose a PNG or JPEG logo under 180 KB.');
      const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
      const fragment = validateTemplate({ schema: TEMPLATE_SCHEMA, html: `<img src="${src}" alt="Store logo" style="width:120pt;height:auto">`, css: '' }, kind);
      insert(fragment.html);
    } catch (error) { report(error.message || 'The logo could not be added.', true); }
    finally { event.target.value = ''; }
  });
  const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  setSource(current); setMode('visual'); report(initial ? 'Your saved template is ready to edit.' : 'Start with this design or paste your HTML and CSS.');
  return { getTemplate, hasUnsavedChanges: () => dirty, destroy() { destroyed = true; clearPreview(); editor?.destroy(); window.removeEventListener('beforeunload', beforeUnload); host.replaceChildren(); } };
}
