"""Retain text/bounds checks for synthetic PDF fixtures. Not ISO certification."""
import json
from pathlib import Path
import fitz

records = []
for path in sorted(Path('output/examples').glob('*.pdf')) + sorted(Path('output/layout').glob('*.pdf')):
    doc = fitz.open(path)
    content = '\n'.join(page.get_text() for page in doc)
    if path.parent.name == 'layout':
        for number in range(1, 61):
            assert f'LONG-{number:03}' in content, (path.name, number)
        if 'order-summary' in path.name:
            assert '$600.00' in content
        else:
            assert '$' not in content
    else:
        assert 'Cedar & Form' in content and 'Alex Morgan' in content
        assert 'LIN-MOSS' in content and 'BWL-CHALK' in content
        if 'order-summary' in path.name:
            assert '$282.96' in content
        else:
            assert '$' not in content
    for page in doc:
        for word in page.get_text('words'):
            assert -0.5 <= word[0] <= word[2] <= page.rect.width + 0.5, (path.name, word)
            assert -0.5 <= word[1] <= word[3] <= page.rect.height + 0.5, (path.name, word)
    records.append({'file': str(path), 'pages': len(doc), 'expected_text_present': True, 'text_within_page': True})
Path('output/pdf-text-verification.json').write_text(json.dumps(records, indent=2))
print(json.dumps(records, indent=2))
