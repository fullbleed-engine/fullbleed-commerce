"""Decode the captured fixture message using Python's standard MIME parser."""
import hashlib
import json
import sys
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
from pathlib import Path

message = BytesParser(policy=policy.default).parsebytes(Path(sys.argv[1]).read_bytes())
assert not message.defects
attachments = []
for part in message.iter_attachments():
    assert not part.defects
    data = part.get_payload(decode=True)
    attachments.append({
        'filename': part.get_filename(),
        'contentType': part.get_content_type(),
        'disposition': part.get_content_disposition(),
        'bytes': len(data),
        'pdfSignature': data.startswith(b'%PDF-'),
        'sha256': hashlib.sha256(data).hexdigest(),
    })
print(json.dumps({
    'attachments': attachments,
    'to': [address for _, address in getaddresses(message.get_all('To', []))],
    'subject': str(message.get('Subject', '')),
    'received': [str(value) for value in message.get_all('Received', [])],
}))
