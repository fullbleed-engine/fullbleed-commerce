"""Exercise typography through the real editor UI, with synthetic templates."""
from playwright.sync_api import expect
from pypdf import PdfReader


def check_editor_typography(page, check, screenshot):
    def source():
        expect(page.locator('[data-canvas]')).to_have_attribute('aria-busy', 'false')
        page.locator('[data-mode="source"]').click()
        return (page.locator('[data-html]').input_value(), page.locator('[data-css]').input_value())

    def select(selector='h1'):
        page.locator('[data-mode="visual"]').click()
        expect(page.locator('[data-canvas]')).to_have_attribute('aria-busy', 'false')
        element = page.frame_locator('[data-visual] iframe.gjs-frame').locator(selector)
        element.click()
        return element

    def field(name):
        return page.locator('.gjs-sm-property__' + name)

    original_html, original_css = source()
    message = page.locator('[data-message]').inner_text()
    heading = select()
    expected = heading.evaluate('e => {const s=getComputedStyle(e); return {family:s.fontFamily, size:Math.round(parseFloat(s.fontSize)*750)/1000, color:s.color, weight:s.fontWeight};}')
    expect(field('font-family').locator('select')).to_have_value(expected['family'].strip('"'))
    expect(field('font-size').locator('input')).to_have_value(str(expected['size']))
    expect(field('font-size').locator('select')).to_have_value('pt')
    expect(field('font-weight').locator('select')).to_have_value(expected['weight'])
    expect(field('color').locator('input')).to_have_value(expected['color'])
    expect(field('font-size').locator('[data-clear-style]')).not_to_be_visible()
    check('typography controls show the selected canvas font, points, weight and color', True)
    check('selecting existing typography does not mark the template unsaved', page.locator('[data-message]').inner_text() == message)
    page.screenshot(path=str(screenshot), full_page=True)
    check('reading typography preserves original CSS without computed overrides', source()[1].strip() == original_css.strip())

    heading = select()
    size = field('font-size').locator('input')
    expect(size).to_have_value(str(expected['size']))
    size.fill('32')
    size.press('Enter')
    # Firefox quantizes canvas CSS pixels at the editor's zoom (42.6875px),
    # while Chromium/WebKit report approximately 42.6667px. The PDF below must
    # still contain exactly 32-point type, independent of that browser readout.
    page.wait_for_function('''() => {
        const frame = document.querySelector('[data-visual] iframe.gjs-frame');
        const size = parseFloat(frame.contentWindow.getComputedStyle(frame.contentDocument.querySelector('h1')).fontSize);
        return Math.abs(size - 32 * 4 / 3) < 0.05;
    }''')
    expect(field('font-size').locator('[data-clear-style]')).to_be_visible()
    check('editing the point control changes the selected heading', True)
    page.locator('[data-action="preview"]').click()
    page.locator('[data-pdf]').wait_for(state='visible')
    content = page.locator('[data-pdf-link]').evaluate('async link => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))')
    pdf = screenshot.with_suffix('.pdf')
    pdf.write_bytes(bytes(content))
    sizes = []
    for pdf_page in PdfReader(pdf).pages:
        pdf_page.extract_text(visitor_text=lambda text, cm, tm, font, size: sizes.append(size) if text.strip() else None)
    check('the real PDF preview uses the visually selected 32-point type', 32 in sizes)
    page.locator('[data-action="undo"]').click()
    expect(size).to_have_value(str(expected['size']))
    page.locator('[data-action="redo"]').click()
    expect(size).to_have_value('32')
    field('font-size').locator('[data-clear-style]').click()
    expect(size).to_have_value(str(expected['size']))
    expect(field('font-size').locator('[data-clear-style]')).not_to_be_visible()
    check('undo, redo and clearing an override restore the canvas typography', True)
    field('font-family').locator('select').select_option('Inter')
    expect(heading).to_have_css('font-family', 'Inter')
    field('font-family').locator('[data-clear-style]').click()
    expect(field('font-family').locator('select')).to_have_value(expected['family'].strip('"'))
    check('clearing a font change restores the original CSS family', True)
    check('clearing visual typography leaves original print CSS intact', source()[1].strip() == original_css.strip())

    # A child with no inline style still needs its inherited CSS values. Cover
    # a font stack, a variable weight and negative spacing outside the presets.
    page.locator('[data-html]').fill(original_html + '<div class="fb-type-test"><span id="fb-type-test">INHERITED TYPE</span></div>')
    page.locator('[data-css]').fill(original_css + '\n.fb-type-test { font-family: Inter, sans-serif; font-size: 12pt; font-weight: 650; letter-spacing: -.25pt; line-height: 1.4; color: #135724; }')
    child = select('#fb-type-test')
    expect(field('font-family').locator('select')).to_have_value('Inter, sans-serif')
    expect(field('font-weight').locator('select')).to_have_value('650')
    inherited = child.evaluate('''e => Object.fromEntries(['font-size','letter-spacing','line-height'].map(name =>
        [name, String(Math.round(parseFloat(getComputedStyle(e).getPropertyValue(name))*750)/1000)]))''')
    for name, value in inherited.items():
        expect(field(name).locator('input')).to_have_value(value)
    check('inherited font stacks, variable weights and negative spacing remain editable', True)
    source()
    page.locator('[data-html]').fill(original_html)
    page.locator('[data-css]').fill(original_css)
    select()
    expect(field('font-size').locator('input')).to_have_value(str(expected['size']))
    expect(field('font-family').locator('select')).to_have_value(expected['family'].strip('"'))
    check('returning to the template refreshes typography without stale values', True)
