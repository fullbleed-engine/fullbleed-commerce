"""Repeat the synthetic pagination sweep, retaining failures without retrying them."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import time


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, default=5, choices=range(1, 21), metavar='1..20')
    parser.add_argument('--node', default='node')
    parser.add_argument('--debugger', choices=['none', 'gdb'], default='none')
    parser.add_argument('--output', default='output/native-stability')
    return parser.parse_args()


def run_logged(command, *, cwd, env, log, timeout=180):
    with log.open('w', encoding='utf-8') as stream:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream,
                                 stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
        try:
            return {'exitCode': child.wait(timeout=timeout), 'timedOut': False}
        except subprocess.TimeoutExpired:
            # GDB also owns a Node child. Reap the entire isolated process group.
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.wait()
            return {'exitCode': child.returncode, 'timedOut': True}


def main():
    args = arguments()
    root = Path(__file__).resolve().parents[1]
    node = shutil.which(args.node)
    if not node:
        raise SystemExit('Node executable not found.')
    debugger = shutil.which('gdb') if args.debugger == 'gdb' else None
    if args.debugger == 'gdb' and (not debugger or os.name == 'nt'):
        raise SystemExit('The gdb mode requires Linux with GDB installed.')
    output = Path(args.output).resolve()
    # Reusing an old run directory could make stale PDFs look like a success.
    output.mkdir(parents=True, exist_ok=False)
    diagnostic_home = output / 'empty-home'
    diagnostic_home.mkdir()
    # Native diagnostics and core memory must not contain operator credentials.
    allowed = ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
    env = {key: os.environ[key] for key in allowed if key in os.environ}
    env.update(HOME=str(diagnostic_home), USERPROFILE=str(diagnostic_home), LANG='C.UTF-8', TZ='UTC', SHELL='/bin/sh')
    report = {'schema': 'fullbleed.native-stability.v1',
              'checkedAt': datetime.now(timezone.utc).isoformat(),
              'nodeVersion': subprocess.check_output([node, '--version'], env=env, text=True).strip(),
              'platform': platform.platform(), 'pythonVersion': platform.python_version(),
              'debugger': args.debugger, 'requestedRuns': args.runs,
              'sourceSha256': {str(file.relative_to(root)).replace('\\', '/'):
                               hashlib.sha256(file.read_bytes()).hexdigest()
                               for file in sorted([root / 'package-lock.json',
                                                   *root.glob('src/*.js'), *root.glob('pro/*.js'),
                                                   *root.glob('fixtures/*.json'),
                                                   root / 'tools/render-pagination.mjs',
                                                   root / 'tools/check-pagination.py',
                                                   root / 'tools/check-native-stability.py',
                                                   root / 'tools/capture-native.gdb'])},
              'ok': False, 'runs': []}
    reference = None
    for index in range(1, args.runs + 1):
        folder = output / f'run-{index:02d}'
        folder.mkdir()
        pdfs = folder / 'pdfs'
        command = [node, '--report-on-fatalerror', '--report-uncaught-exception',
                   '--report-exclude-env', '--report-exclude-network',
                   '--report-directory=' + str(folder), 'tools/render-pagination.mjs', str(pdfs), '--diagnostic-worker']
        if debugger:
            command = [debugger, '--batch', '--return-child-result', '-x',
                       str(root / 'tools/capture-native.gdb'), '--args', *command]
        start = time.monotonic()
        item = {'run': index, **run_logged(command, cwd=root, env=env, log=folder / 'process.log')}
        item['seconds'] = round(time.monotonic() - start, 3)
        journal = pdfs / 'progress.jsonl'
        progress = []
        item['journalError'] = None
        for line in journal.read_text().splitlines() if journal.exists() else []:
            try:
                progress.append(json.loads(line))
            except json.JSONDecodeError as error:
                # A native failure may interrupt the final write. Keep earlier
                # complete breadcrumbs and still emit the failed run summary.
                item['journalError'] = str(error)
                break
        item['lastProgress'] = progress[-1] if progress else None
        item['pdfs'] = len(list(pdfs.glob('*.pdf')))
        item['debuggerStopped'] = 'FULLBLEED_DEBUGGER_STOPPED_WITH_LIVE_INFERIOR' in (folder / 'process.log').read_text()
        item['complete'] = (pdfs / 'rendered.json').exists() and bool(progress) and progress[-1]['phase'] == 'complete'
        item['ok'] = item['exitCode'] == 0 and not item['timedOut'] and not item['debuggerStopped'] and not item['journalError'] and item['complete'] and item['pdfs'] == 181
        if item['ok']:
            check = run_logged([sys.executable, str(root / 'tools/check-pagination.py'), str(pdfs)],
                               cwd=root, env=env, log=folder / 'independent-reader.log')
            item['independentReader'] = check
            item['ok'] = check['exitCode'] == 0 and not check['timedOut']
            hashes = {file.name: hashlib.sha256(file.read_bytes()).hexdigest() for file in sorted(pdfs.glob('*.pdf'))}
            item['matchesFirstRun'] = reference is None or hashes == reference
            reference = reference or hashes
            item['ok'] = item['ok'] and item['matchesFirstRun']
        report['runs'].append(item)
        report['ok'] = len(report['runs']) == args.runs and all(run['ok'] for run in report['runs'])
        (output / 'verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(item), flush=True)
        if not item['ok']:
            break
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
