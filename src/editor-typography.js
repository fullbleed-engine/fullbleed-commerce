// SPDX-License-Identifier: GPL-2.0-or-later

// Print CSS stays outside GrapesJS so its parser cannot rewrite @page rules,
// counters or merchant source. Read canvas typography into the controls only;
// selecting an element must not add styles to the template or undo history.
export function syncCanvasTypography(editor, host) {
  const component = editor.getSelected();
  const element = component?.getEl();
  const target = editor.StyleManager.getSelected();
  if (!element || !target) return;
  const computed = element.ownerDocument.defaultView.getComputedStyle(element);
  const ownStyle = target.getStyle();
  const properties = editor.StyleManager.getProperties('typography');
  properties?.forEach(property => {
    const name = property.getName();
    const control = host.querySelector(`.gjs-sm-property__${name}`);
    const fromCanvas = !Object.hasOwn(ownStyle, name);
    let value = fromCanvas ? computed.getPropertyValue(name) : property.getFullValue();
    if (fromCanvas && ['font-size', 'line-height', 'letter-spacing'].includes(name) && value.endsWith('px')) {
      // CSS pixels are 1/96in; points are 1/72in. Display print units without
      // serializing the rounded readout back into the merchant's stylesheet.
      value = `${Math.round(parseFloat(value) * 0.75 * 1000) / 1000}pt`;
    }
    if (fromCanvas && name === 'font-family') {
      // Match our named choices without discarding a merchant's fallback stack.
      const family = value.replace(/^(["'])(.*)\1$/, '$2');
      if (['Inter', 'DM Serif Display', 'Bebas Neue'].includes(family)) value = family;
    }
    if (fromCanvas && name === 'text-align' && ['start', 'end'].includes(value)) {
      value = (value === 'start') === (computed.direction !== 'rtl') ? 'left' : 'right';
    }
    // A CSS font stack or variable weight may not be one of the preset options.
    // Use DOM text/value setters: merchant CSS must never become option markup.
    if (property.getType() === 'select') {
      const select = control?.querySelector('select');
      select?.querySelector('[data-fb-css-option]')?.remove();
      if (select && value && !Array.from(select.options).some(option => option.value === value)) {
        const option = select.ownerDocument.createElement('option');
        option.value = value;
        option.textContent = value;
        option.dataset.fbCssOption = '';
        select.append(option);
      }
    }
    if (control) control.toggleAttribute('data-fb-canvas-value', fromCanvas);
    if (fromCanvas && value) property.upValue(value, { noTarget: true });
  });
}
