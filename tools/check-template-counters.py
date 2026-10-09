"""Check actual numbered template text with an independent PDF reader."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from pypdf import PdfReader

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'output/template-counters')
record = json.loads((out / 'rendered.json').read_text(encoding='utf-8'))
pdf = out / 'document.pdf'
pages = [' '.join(page.extract_text().split()) for page in PdfReader(pdf).pages]
text = '\n'.join(pages)
labels = re.findall(r'\[(\d+\.\d+)\]', text)
checks = {
    'hash matches rendered bytes': sha256(pdf.read_bytes()).hexdigest() == record['sha256'],
    'page count matches independent reader': len(pages) == record['pages'] == 2,
    'sibling counter increments and chapter reset are correct': labels == record['expectedLabels'],
    'each care instruction occurs once': all(text.count(value) == 1 for value in record['expectedText']),
    'care instructions occupy the explicit final page': all(value in pages[-1] for value in record['expectedText']),
    'escaped order fields resolve in the care appendix': record['orderNumber'] in pages[-1] and 'Cedar & Form' in pages[-1],
    'no unexpanded template fields': '{{' not in text,
}
report = {**record, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'reader': 'pypdf',
          'labels': labels, 'checks': checks, 'ok': all(checks.values())}
(out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
if '--negative-control' in sys.argv:
    assert all(value for key, value in checks.items() if key != 'sibling counter increments and chapter reset are correct')
    assert not checks['sibling counter increments and chapter reset are correct'], 'Old renderer unexpectedly passes this regression.'
else:
    assert report['ok'], 'Template output failed independent verification.'
