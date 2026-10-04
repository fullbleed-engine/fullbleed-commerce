"""Prove the diagnostic harness captures a controlled native abort and a timeout."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--node', default='node')
parser.add_argument('--output', default='output/native-diagnostic-capture')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('stability', root / 'tools/check-native-stability.py')
stability = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stability)
node, gdb = shutil.which(args.node), shutil.which('gdb')
assert node and gdb and os.name != 'nt', 'Run on Linux with Node and GDB.'
output = Path(args.output).resolve()
output.mkdir(parents=True, exist_ok=False)
env = {'PATH': os.environ['PATH'], 'HOME': str(output), 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'SHELL': '/bin/sh'}
flags = ['--report-uncaught-exception', '--report-exclude-env', '--report-exclude-network', '--report-directory=' + str(output)]
exception = stability.run_logged([node, *flags, '-e', "throw new Error('synthetic diagnostic check')"],
                                 cwd=root, env=env, log=output / 'exception.log')
assert exception == {'exitCode': 1, 'timedOut': False}, exception
reports = list(output.glob('report.*.json'))
assert len(reports) == 1, reports
report = json.loads(reports[0].read_text())
assert 'environmentVariables' not in report
assert 'networkInterfaces' not in report['header']
abort = stability.run_logged([gdb, '--batch', '--return-child-result', '-x', str(root / 'tools/capture-native.gdb'),
                             '--args', node, '-e', 'process.abort()'],
                            cwd=root, env=env, log=output / 'abort.log')
trace = (output / 'abort.log').read_text()
assert abort['exitCode'] != 0 and not abort['timedOut'], abort
assert 'SIGABRT' in trace and 'FULLBLEED_DEBUGGER_STOPPED_WITH_LIVE_INFERIOR' in trace
assert 'node::Abort' in trace and '#0' in trace, 'Native stack was not captured.'
timeout = stability.run_logged([node, '-e', 'setInterval(() => {}, 1000)'],
                              cwd=root, env=env, log=output / 'timeout.log', timeout=1)
assert timeout['timedOut'] and timeout['exitCode'] != 0, timeout
result = {'schema': 'fullbleed.native-diagnostic-capture.v1', 'ok': True,
          'exceptionCapturedWithoutEnvironmentOrNetwork': True,
          'nativeAbortCapturedWithStack': True, 'timeoutStopped': True,
          'scope': 'Controlled child failures verify the harness; they do not reproduce the original SIGSEGV.'}
(output / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
