// SPDX-License-Identifier: MIT
/** Read the small settings form without buffering an unbounded chunked body. */
export async function readSettingsForm(request) {
  const limit = 8192;
  const reject = (message, status) => new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/x-www-form-urlencoded') throw reject('Use the brand settings form.', 415);
  if (Number(request.headers.get('Content-Length')) > limit) throw reject('Settings are too large.', 413);
  const reader = request.body?.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw reject('Settings are too large.', 413);
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode();
  } catch (error) {
    await reader?.cancel().catch(() => {});
    if (error instanceof Response) throw error;
    throw reject('Could not read the brand settings.', 400);
  } finally {
    reader?.releaseLock();
  }
  const form = new FormData();
  for (const [key, value] of new URLSearchParams(text)) form.append(key, value);
  return form;
}
