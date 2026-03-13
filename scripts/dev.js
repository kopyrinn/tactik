const { spawn } = require('child_process');
const path = require('path');

const services = [
  { name: 'server', cwd: path.join(__dirname, '..', 'apps', 'server') },
  { name: 'web', cwd: path.join(__dirname, '..', 'apps', 'web') },
];

const children = [];
let shuttingDown = false;

function pipeWithPrefix(stream, prefix, target) {
  stream.on('data', (chunk) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.length === 0 && i === lines.length - 1) {
        continue;
      }
      target.write(`[${prefix}] ${line}\n`);
    }
  });
}

function spawnService(service) {
  const child = spawn('npm', ['run', 'dev'], {
    cwd: service.cwd,
    shell: true,
    env: process.env,
  });

  pipeWithPrefix(child.stdout, service.name, process.stdout);
  pipeWithPrefix(child.stderr, service.name, process.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[runner] ${service.name} exited with ${reason}`);
    shutdown(typeof code === 'number' && code !== 0 ? code : 1);
  });

  children.push(child);
}

function killChild(child) {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: true,
    });
    return;
  }

  child.kill('SIGTERM');
}

function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    killChild(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

for (const service of services) {
  spawnService(service);
}
