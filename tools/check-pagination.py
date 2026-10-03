"""Check actual summary PDFs, independently of the engine's layout report."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import re
import sys
from pypdf import PdfReader

out = Path(sys.argv[1] if len(sys.argv) > 1 else 'output/pagination')
rendered = json.loads((out / 'rendered.json').read_text(encoding='utf-8'))
documents = []
failures = []
for item in rendered['documents']:
    pdf = out / item['file']
    pages = [' '.join(page.extract_text().split()) for page in PdfReader(pdf).pages]
    text = '\n'.join(pages)
    checks = {
        'hash matches rendered bytes': sha256(pdf.read_bytes()).hexdigest() == item['sha256'],
        'page count matches independent reader': len(pages) == item['pages'],
        'all items occur exactly once': sorted(re.findall(r'CHECK-\d{3}', text)) == [f'CHECK-{i:03d}' for i in range(1, item['items'] + 1)],
        'store amounts occur exactly once': all(text.count(amount) == 1 for amount in ['$4,320.00', '$12.00', '$4,332.00']),
        'closing note occurs exactly once': text.count('Thank you for shopping with us.') == 1,
        'closing note and all totals share final page': all(value in pages[-1] for value in ['Thank you for shopping with us.', '$4,320.00', '$12.00', '$4,332.00']),
        'no empty pages': all(page.strip() for page in pages),
    }
    failed = [name for name, passed in checks.items() if not passed]
    if failed:
        failures.append({'file': item['file'], 'failed': failed})
    documents.append({**item, 'checks': checks})

saved = rendered.get('savedTemplate')
if saved:
    saved['unchanged'] = sha256((out / saved['file']).read_bytes()).hexdigest() == saved['expectedSha256']
    if not saved['unchanged']:
        failures.append({'file': saved['file'], 'failed': ['saved template PDF changed']})
report = {'schema': 'fullbleed.commerce-pagination-verification.v1', 'checkedAt': datetime.now(timezone.utc).isoformat(), 'reader': 'pypdf', 'ok': not failures, 'documents': documents, 'savedTemplate': saved, 'failures': failures}
(out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ok': report['ok'], 'documents': len(documents), 'checks': sum(len(item['checks']) for item in documents), 'failures': failures}, indent=2))
sys.exit(1 if failures else 0)
