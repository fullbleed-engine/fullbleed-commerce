// SPDX-License-Identifier: MIT
import { randomBytes } from 'node:crypto';

/** Link credentials stay in the URL fragment, then a POST header, never access-log query strings. */
export function downloadPage(id) {
  if (!/^[0-9a-f-]{36}$/.test(id || '')) return new Response('Link unavailable.', { status: 404 });
  const nonce = randomBytes(18).toString('base64');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Your document · Fullbleed</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#193f36;font:17px/1.6 system-ui,sans-serif}main{max-width:520px;margin:12vh auto;padding:32px}.brand{font-weight:750;letter-spacing:.12em;font-size:13px}h1{font:500 42px/1.12 Georgia,serif;letter-spacing:-.03em;margin-top:48px}button{background:#193f36;color:white;border:0;border-radius:8px;padding:15px 24px;font:600 16px system-ui;cursor:pointer}button:disabled{opacity:.6;cursor:wait}small{display:block;margin-top:38px;color:#61706a}#status{min-height:54px}button:focus-visible{outline:3px solid #bd7a2b;outline-offset:4px}</style></head>
<body><main><div class="brand">FULLBLEED</div><h1>Your document<br>is ready to open.</h1><p>The store shared a private, time-limited PDF link with you.</p><button id="download">Download PDF</button><p id="status" role="status" aria-live="polite"></p><small>Keep this link private. If the order changes or the link expires, ask the store for a new one.</small></main>
<script nonce="${nonce}">
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);
const button=document.getElementById('download'),status=document.getElementById('status');
if(!/^[A-Za-z0-9_-]{43}$/.test(token)){button.disabled=true;status.textContent='Open the complete link shared by the store.';}
button.addEventListener('click',async()=>{button.disabled=true;status.textContent='Preparing your PDF…';try{
const response=await fetch(location.pathname,{method:'POST',credentials:'omit',headers:{Authorization:'Bearer '+token}});
if(!response.ok){let message='The document is unavailable. Ask the store for a new link.';try{message=(await response.json()).message||message;}catch{}throw new Error(message);}
if(!response.headers.get('Content-Type')?.startsWith('application/pdf'))throw new Error('The document could not be opened. Please try again.');
const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]||'document.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent='Your PDF has downloaded.';
}catch(error){status.textContent=error.message;}finally{button.disabled=false;}});
</script></body></html>`, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
  } });
}
