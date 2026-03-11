import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dir, '..');
const backendDir = join(repoRoot, 'backend');
const binariesDir = join(repoRoot, 'tauri', 'src-tauri', 'binaries');
const isWindows = process.platform === 'win32';
const venvPython = isWindows
  ? join(repoRoot, '.venv', 'Scripts', 'python.exe')
  : join(repoRoot, '.venv', 'bin', 'python');
const pythonCommand = existsSync(venvPython) ? venvPython : 'python';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: isWindows,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function getHostTuple() {
  const result = spawnSync('rustc', ['--print', 'host-tuple'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: isWindows,
  });

  if (result.status !== 0) {
    return 'unknown';
  }

  return result.stdout.trim() || 'unknown';
}

console.log(`Building vibetube-server for platform: ${getHostTuple()}`);

const pyInstallerCheck = spawnSync(pythonCommand, ['-c', 'import PyInstaller'], {
  cwd: repoRoot,
  stdio: 'ignore',
  shell: isWindows,
});

if (pyInstallerCheck.status !== 0) {
  console.log('Installing PyInstaller...');
  run(pythonCommand, ['-m', 'pip', 'install', 'pyinstaller']);
}

run(pythonCommand, ['build_binary.py'], { cwd: backendDir });

mkdirSync(binariesDir, { recursive: true });

const platform = getHostTuple();
const builtBinary = join(backendDir, 'dist', `vibetube-server${isWindows ? '.exe' : ''}`);
const destination = join(binariesDir, `vibetube-server-${platform}${isWindows ? '.exe' : ''}`);

if (!existsSync(builtBinary)) {
  console.error(`Error: Binary not found at ${builtBinary}`);
  process.exit(1);
}

copyFileSync(builtBinary, destination);

if (!isWindows) {
  chmodSync(destination, 0o755);
}

console.log(`Built ${destination}`);
console.log('Build complete!');
