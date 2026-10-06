// SPDX-License-Identifier: MIT
// Loaded only by the disposable HTTP test server, never by production startup.
import { ChildProcess } from 'node:child_process';
const original = ChildProcess.prototype.spawn;
let killed = false;
ChildProcess.prototype.spawn = function(options) {
  const render = options.args.some(arg => String(arg).endsWith('process-worker.cjs'));
  const result = original.call(this, options);
  if (render && !killed) {
    killed = true;
    this.once('spawn', () => this.kill('SIGKILL'));
  }
  return result;
};
