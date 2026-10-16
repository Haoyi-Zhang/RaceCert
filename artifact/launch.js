'use strict';

const childProcess = require('node:child_process');
const readline = require('node:readline');
const { probePythonVerifier } = require('./python-runner');
const runtime = probePythonVerifier();
if (!runtime.ok) { process.stderr.write(`${runtime.reason}\n`); process.exit(1); }
process.stdout.write(`${runtime.runtime} verified. Local loopback only.\n`);

const child = childProcess.spawn(process.execPath, [require.resolve('./server')], { cwd: __dirname, stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true });
let opened = false;
const lines = readline.createInterface({ input: child.stdout });
lines.on('line', (line) => {
  process.stdout.write(`${line}\n`);
  const match = line.match(/https?:\/\/127\.0\.0\.1:\d+/);
  if (!opened && match) {
    opened = true;
    const guidedUrl = match[0] + '/guided.html';
    process.stdout.write(`Guided booth: ${guidedUrl}\nAdvanced certificate explorer: ${match[0]}/index.html\n`);
    const command = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', guidedUrl]] : process.platform === 'darwin' ? ['open', [guidedUrl]] : ['xdg-open', [guidedUrl]];
    if (process.env.RACECERT_NO_BROWSER !== '1') {
      const opener = childProcess.spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
      opener.on('error', (error) => process.stderr.write(`Browser launch failed: ${error.message}. Open ${guidedUrl} manually.\n`));
      opener.unref();
      process.stdout.write('Browser launch requested. Press Ctrl+C here to stop the demo.\n');
    }
  }
});
child.on('exit', (code) => { process.exitCode = code ?? 0; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
