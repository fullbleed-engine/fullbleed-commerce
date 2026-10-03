// SPDX-License-Identifier: MIT
// Own the synthetic stores and browser processes for one isolated CI browser job.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';

const engine = process.env.FULLBLEED_TEST_BROWSER || 'chrome';
assert.ok(['chrome', 'firefox', 'webkit'].includes(engine));
const python = process.env.FULLBLEED_TEST_PYTHON || 'python';
const label = name => engine === 'chrome' ? name : `${name}-${engine}`;
const environment = { ...process.env, FULLBLEED_TEST_BROWSER: engine };
delete environment.FULLBLEED_TEST_SAVED_TITLE;
await mkdir('target/browser-workflows', { recursive: true });
await mkdir('output/browser-workflows', { recursive: true });
const children = new Set();

async function unusedPort(port) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); reject(new Error(`Port ${port} is already in use; no existing service was changed.`)); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`Could not verify port ${port}.`)); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
}

function start(command, args, name, env) {
  const log = createWriteStream(`target/browser-workflows/${engine}-${name}.log`);
  const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  children.add(child);
  let tail = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    log.write(chunk);
    tail = (tail + chunk.toString()).slice(-6000);
  });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      children.delete(child);
      log.end();
      resolve({ code, signal });
    });
  });
  // Servers may fail while their readiness promise is still waiting.
  completed.catch(() => {});
  return { child, completed, tail: () => tail };
}

async function server(args, name, marker, port, extra = {}) {
  await unusedPort(port);
  console.log(`Preparing ${engine} ${name} fixture on loopback port ${port}.`);
  const service = start(process.execPath, args, name, { ...environment, ...extra });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} did not become ready within ten minutes.\n${service.tail()}`)), 600000);
    const ready = chunk => {
      if (service.tail().includes(marker) || chunk.toString().includes(marker)) {
        clearTimeout(timer);
        service.child.stdout.off('data', ready);
        resolve();
      }
    };
    service.child.stdout.on('data', ready);
    service.completed.then(({ code }) => { clearTimeout(timer); reject(new Error(`${name} exited before readiness (${code}).\n${service.tail()}`)); }, error => { clearTimeout(timer); reject(error); });
  });
  return service;
}

async function run(script, name, extra = {}) {
  console.log(`Checking ${engine} ${name} in a fresh owned browser.`);
  const task = start(python, [script], name, { ...environment, ...extra });
  const result = await task.completed;
  assert.equal(result.code, 0, `${name} failed.\n${task.tail()}`);
  console.log(task.tail().trim());
}

async function stop(task) {
  if (task.child.exitCode === null && task.child.signalCode === null) task.child.kill();
  await task.completed;
}

try {
  const staff = await server(['tools/wordpress.mjs', '--pro', '--hpos', '--packages'], 'staff-store', 'FULLBLEED_LOCAL_STORE_READY', 9496, { FULLBLEED_TEST_PORT: '9496' });
  await run('tools/check-browser.py', 'staff-browser', { FULLBLEED_TEST_URL: 'http://127.0.0.1:9496', FULLBLEED_TEST_PRO: '1', FULLBLEED_TEST_LABEL: 'wordpress-matrix' });
  await stop(staff);
  const customer = await server(['tools/check-customer-downloads.mjs', '--hpos', '--packages', '--serve'], 'customer-store', 'FULLBLEED_CUSTOMER_PREVIEW_READY', 9482);
  await run('tools/check-customer-browser.py', 'customer-browser');
  await stop(customer);
  const alerts = await server(['tools/check-automation.mjs', '--hpos', '--serve'], 'alerts-store', 'FULLBLEED_ACTIVITY_PREVIEW_READY', 9478);
  await run('tools/check-alerts-browser.py', 'alerts-browser');
  await stop(alerts);
  const staffRecord = JSON.parse(await readFile(`output/browser/${label('wordpress-matrix')}-verification.json`, 'utf8'));
  const customerRecord = JSON.parse(await readFile(`output/browser/${label('wordpress-customer')}-verification.json`, 'utf8'));
  const alertsRecord = JSON.parse(await readFile(`output/browser/${label('wordpress-alerts')}-verification.json`, 'utf8'));
  for (const record of [staffRecord, customerRecord, alertsRecord]) {
    assert.equal(record.browserEngine, engine);
    assert.ok(record.checks.length > 0 && record.checks.every(check => check.passed === true));
    assert.deepEqual(record.pageErrors, []);
  }
  const packages = JSON.parse(await readFile('dist/packages.json', 'utf8'));
  for (const item of packages) assert.equal(createHash('sha256').update(await readFile(`dist/${item.filename}`)).digest('hex'), item.sha256);
  assert.deepEqual(customerRecord.packages, packages);
  await writeFile(`output/browser-workflows/${engine}.json`, JSON.stringify({ checkedAt: new Date().toISOString(), syntheticOnly: true, engine, hpos: true, packages, staff: staffRecord, customer: customerRecord, alerts: alertsRecord, scope: 'Actual browser editing and downloads on disposable WordPress. Alert controls use the source-mounted automation fixture with captured mail. Customer renderer HTTPS transport is substituted with a fixture using real Fullbleed PDF bytes. No production network, email delivery or branded Safari claim.' }, null, 2) + '\n');
} finally {
  await Promise.allSettled([...children].map(child => new Promise(resolve => {
    child.once('close', resolve);
    child.kill();
  })));
}
