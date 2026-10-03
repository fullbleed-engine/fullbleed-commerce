// SPDX-License-Identifier: MIT
// Actual SMTP receipt in a private container network; no relay or public port.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderOrder } from '../../src/node.js';
import { starterTemplate } from '../../src/documents.js';

export async function checkSmtpWorkflows({ project, network, wordpress, output, scratch, containers, run, compose, php, copyOut, waitUntil, passed }) {
  const image = 'axllent/mailpit:v1.31.4@sha256:b68349e3a014b90c5610bfb26b2ae36f3892d7b8cf25ee140c6c71c98d2fcf48';
  const server = `${project}-smtp`;
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const check = (name, ok) => { assert.ok(ok, name); passed(`SMTP: ${name}`); };
  run(['pull', image], { timeout: 180000 });
  containers.push(server);
  run(['run', '-d', '--name', server, '--network', network, '--network-alias', 'mailpit', '--memory', '128m', '--pids-limit', '64', image]);
  const api = path => Buffer.from(run(['exec', wordpress, 'php', '-r', '$body=file_get_contents($argv[1]);if($body===false)exit(1);echo base64_encode($body);', `http://mailpit:8025/api/v1/${path}`]), 'base64');
  const inbox = () => JSON.parse(api('messages'));
  await waitUntil(() => { try { return inbox().total === 0; } catch { return false; } }, 'private SMTP inbox');
  const container = JSON.parse(run(['inspect', server]))[0];
  check('SMTP and mailbox API expose no host ports and have no external relay', !Object.keys(container.HostConfig.PortBindings || {}).length && Object.keys(container.NetworkSettings.Networks).length === 1 && container.NetworkSettings.Networks[network]);

  run(['exec', wordpress, 'mkdir', '-p', '/var/www/html/wp-content/mu-plugins']);
  run(['cp', resolve('tools/renderer-fixture/smtp-mu.php'), `${wordpress}:/var/www/html/wp-content/mu-plugins/fullbleed-smtp-fixture.php`]);
  run(['cp', resolve('tools/renderer-fixture/smtp-control.php'), `${wordpress}:/tmp/fullbleed-smtp-control.php`]);
  const template = starterTemplate({ kind: 'order-summary' });
  template.html = template.html.replace('{{document.title}}', 'YOUR CEDAR ORDER');
  const templateFile = join(scratch, 'smtp-template.json');
  writeFileSync(templateFile, JSON.stringify(template));
  run(['cp', templateFile, `${wordpress}:/tmp/fullbleed-smtp-template.json`]);
  const control = mode => php(wordpress, '/tmp/fullbleed-smtp-control.php', [mode]);
  const cron = () => run(['exec', '--user', 'www-data', wordpress, 'php', '/var/www/html/wp-cron.php']);
  const state = () => control('state');
  const seen = new Set();
  const evidence = [];
  const receipts = [];
  const documents = [];
  async function receive(label, expectedTotal, expectedOrder) {
    await waitUntil(() => inbox().total >= expectedTotal, `${label} SMTP receipt`);
    const box = inbox();
    assert.equal(box.total, expectedTotal, `${label}: unexpected duplicate mail`);
    const fresh = box.messages.filter(message => !seen.has(message.ID));
    assert.equal(fresh.length, 1);
    const message = fresh[0]; seen.add(message.ID);
    const raw = api(`message/${encodeURIComponent(message.ID)}/raw`);
    const path = join(output, `smtp-${label}.eml`); writeFileSync(path, raw);
    const parsed = spawnSync(process.env.PYTHON_BIN || 'python3', ['tools/renderer-fixture/inspect-mail.py', path], { encoding: 'utf8', windowsHide: true });
    assert.equal(parsed.status, 0, parsed.stderr);
    const mime = JSON.parse(parsed.stdout);
    check(`${label} reaches the expected synthetic recipient over real SMTP`, mime.to.length === 1 && mime.to[0] === (label === 'alert' ? 'admin@example.test' : 'alex@example.test') && mime.received.length > 0);
    if (expectedOrder) {
      const rendered = await renderOrder(expectedOrder, { kind: 'order-summary', template, previewDpi: 100 });
      assert.equal(rendered.missingGlyphs, 0);
      assert.ok(rendered.pages >= 2, 'The long-order fixture must exercise page breaks.');
      const expected = hash(rendered.pdf);
      assert.equal(mime.attachments.length, 1);
      assert.equal(mime.attachments[0].sha256, expected);
      assert.equal(mime.attachments[0].filename, `fullbleed-order-summary-${expectedOrder.number}.pdf`);
      assert.equal(mime.attachments[0].disposition, 'attachment');
      assert.equal(mime.attachments[0].pdfSignature, true);
      writeFileSync(join(output, `smtp-${label}.pdf`), rendered.pdf);
      for (const [index, png] of rendered.previews.entries()) writeFileSync(join(output, `smtp-${label}-${index + 1}.png`), png);
      documents.push({ phase: label, pages: rendered.pages, missingGlyphs: rendered.missingGlyphs, sha256: expected, bytes: rendered.pdf.length, savedTemplateSha256: hash(Buffer.from(JSON.stringify(template))) });
      evidence.push({ file: `output/renderer-deployment/smtp-${label}.pdf`, sha256: expected });
      check(`${label} inbox attachment matches every byte of the saved-design, multi-page PDF`, true);
    } else assert.equal(mime.attachments.length, 0);
    evidence.push({ file: `output/renderer-deployment/smtp-${label}.eml`, sha256: hash(raw) });
    receipts.push({ phase: label, messageId: message.ID, mimeSha256: hash(raw), ...mime });
    return JSON.parse(api(`message/${encodeURIComponent(message.ID)}`));
  }

  const configured = control('configure');
  check('alerts retain an hourly WordPress schedule and the order has 36 distinct lines', configured.alertScheduled && configured.order.items.length === 36);
  const processing = control('processing');
  const queued = state(); // The prior process has finished its shutdown dispatch.
  check('order transition queues work without rendering or sending during the transition', queued.pending.length === 1 && queued.sent.length === 0 && inbox().total === 0 && !queued.attachmentResult);
  control('due-queue'); cron();
  const healthy = state();
  check('wp-cron processes the persisted WooCommerce queue in a different PHP process', healthy.pending.length === 0 && healthy.sent.length === 1 && healthy.sent[0].cron && healthy.sent[0].pid !== processing.pid);
  await receive('queued', 1, healthy.order);
  control('due-queue'); cron();
  check('repeated cron execution does not duplicate a completed customer email', inbox().total === 1);

  compose(['stop', 'renderer']);
  control('completed');
  check('second order transition persists its email job before the next worker', state().pending.length === 1 && inbox().total === 1);
  control('due-queue'); cron();
  const outage = state();
  check('renderer outage preserves the queued email and records a recoverable failure', outage.pending.length === 0 && outage.attachmentResult.state === 'failed' && outage.attachmentResult.code === 'renderer_502' && outage.failed.length === 1);
  await receive('outage', 2);
  control('due-alert'); cron();
  const alerted = state();
  check('the real WordPress schedule hands the failure summary to SMTP', alerted.alert?.status === 'accepted' && alerted.alertCheck > 0 && alerted.alertScheduled);
  const alert = await receive('alert', 3);
  check('administrator alert contains recovery guidance without customer data or PDFs', alert.Text.includes('Failed email-attachment workflows: 1') && alert.Text.includes('page=fullbleed-activity') && ['Alex', 'Morgan', '42 Example Street', 'alex@example.test', 'YOUR CEDAR ORDER'].every(value => !alert.Text.includes(value)));

  run(['restart', wordpress]);
  control('due-alert'); cron();
  const restarted = state();
  check('a fresh WordPress container process preserves the alert cooldown', restarted.alert.attempted_at === alerted.alert.attempted_at && restarted.alert.status === 'accepted' && inbox().total === 3);
  compose(['up', '-d', '--no-build', '--wait', '--wait-timeout', '90']);
  control('due-queue'); cron();
  check('restoring the renderer never automatically resends a customer email', inbox().total === 3 && state().failed.length === 1);
  const recovered = control('resend');
  await receive('recovery', 4, recovered.order);
  check('explicit WooCommerce resend clears the failed workflow', state().failed.length === 0 && state().attachmentResult.state === 'prepared');
  control('due-alert'); control('due-queue'); cron();
  check('later scheduler runs send neither a stale alert nor duplicate customer mail', inbox().total === 4);

  const final = state();
  const paths = final.sent.flatMap(sent => sent.attachments);
  check('both actual SMTP attachments were private and outside the public root', paths.length === 2 && paths.every(item => item.permissions === 0o600 && item.outsideWebRoot));
  for (const attachment of paths) {
    assert.equal(run(['exec', wordpress, 'php', '-r', 'echo file_exists($argv[1]) ? "present" : "removed";', attachment.path]), 'removed');
  }
  check('temporary PDFs are removed after their SMTP sending requests exit', true);
  copyOut(wordpress, '/tmp/fullbleed-smtp-sent.jsonl', join(output, 'smtp-sent.jsonl'));
  return { image, transport: 'Unmodified WordPress PHPMailer SMTP to private Mailpit; native Action Scheduler through wp-cron.php. No relay, public ports, injected render responses, or send-method overrides.', scheduler: 'Host-driven wp-cron.php; fixture advances due times without calling the delivery hooks itself.', syntheticOnly: true, receipts, documents, evidence, mailCount: final.sent.length, pendingEmailJobs: final.pending.length, alertAfterRestart: restarted.alert, limitations: ['This verifies private SMTP inbox receipt, not external-provider deliverability or a merchant scheduler.', 'The deployment fixture uses HPOS; separate captured-mail checks cover legacy storage.', 'Only synthetic orders and example.test recipients are used.'] };
}
