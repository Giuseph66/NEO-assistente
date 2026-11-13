#!/usr/bin/env node
// Checks that this machine can run the project and prints the fix for each problem.
// Usage: pnpm check
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = join(root, 'apps', 'desktop');
const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = color(32);
const red = color(31);
const yellow = color(33);
const dim = color(2);

let failures = 0;
let warnings = 0;

function ok(label) {
  console.log(`${green('✔')} ${label}`);
}
function fail(label, fix) {
  failures += 1;
  console.log(`${red('✖')} ${label}`);
  if (fix) console.log(dim(`    → ${fix}`));
}
function warn(label, fix) {
  warnings += 1;
  console.log(`${yellow('!')} ${label}`);
  if (fix) console.log(dim(`    → ${fix}`));
}
function has(cmd, args = ['--version']) {
  const res = spawnSync(cmd, args, { stdio: 'ignore' });
  return res.status === 0;
}
function section(title) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------- toolchain
section('Ferramentas');
const engineRange = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines?.node ?? '';
const [minMajor, maxMajorExclusive] = [
  Number(/>=\s*(\d+)/.exec(engineRange)?.[1] ?? 0),
  Number(/<\s*(\d+)/.exec(engineRange)?.[1] ?? Infinity),
];
const recommendedMajor = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= minMajor && nodeMajor < maxMajorExclusive) {
  ok(`Node ${process.versions.node}`);
} else {
  fail(
    `Node ${process.versions.node} fora do suportado (${engineRange})`,
    `nvm install ${recommendedMajor} && nvm use   (lê o .nvmrc)`
  );
}

if (has('pnpm')) ok('pnpm instalado');
else fail('pnpm não encontrado', 'corepack enable   (ou: npm i -g pnpm)');

if (process.platform === 'linux') {
  if (has('python3') && has('make', ['--version']) && has('g++', ['--version'])) {
    ok('Ferramentas de compilação (python3, make, g++)');
  } else {
    fail(
      'Ferramentas de compilação ausentes (necessárias para módulos nativos)',
      'sudo apt install -y build-essential python3 python3-dev libffi-dev'
    );
  }
}

// ---------------------------------------------------------------- install
section('Instalação');
if (existsSync(join(desktop, 'node_modules', '.bin', 'electron-vite'))) {
  ok('Dependências instaladas');
} else {
  fail('Dependências não instaladas (ou instalação interrompida)', 'pnpm install');
}

const requireFromDesktop = createRequire(join(desktop, 'package.json'));
let electronOk = false;
try {
  const electronDir = dirname(requireFromDesktop.resolve('electron/package.json'));
  const pathTxt = join(electronDir, 'path.txt');
  if (existsSync(pathTxt)) {
    const bin = join(electronDir, 'dist', readFileSync(pathTxt, 'utf8').trim());
    electronOk = existsSync(bin);
  }
  if (electronOk) ok('Binário do Electron baixado');
  else fail('Binário do Electron ausente', `node ${join(electronDir, 'install.js')}`);
} catch {
  fail('Pacote electron não encontrado', 'pnpm install');
}

try {
  const sqliteDir = dirname(requireFromDesktop.resolve('better-sqlite3/package.json'));
  if (existsSync(join(sqliteDir, 'build', 'Release', 'better_sqlite3.node'))) {
    ok('Módulos nativos compilados para o Electron');
  } else {
    fail('Módulos nativos não compilados (better-sqlite3)', 'pnpm rebuild:native');
  }
} catch {
  fail('better-sqlite3 não encontrado', 'pnpm install');
}

const libs = ['packages/shared', 'packages/logger', 'packages/config', 'services/engine'];
const missingLibs = libs.filter((lib) => !existsSync(join(root, lib, 'dist', 'index.js')));
if (missingLibs.length === 0) ok('Pacotes do workspace compilados');
else fail(`Pacotes não compilados: ${missingLibs.join(', ')}`, 'pnpm build:libs');

// ---------------------------------------------------------------- optional
if (process.platform === 'linux') {
  section('Recursos opcionais (o app abre sem eles)');
  if (has('arecord')) ok('arecord (microfone para transcrição)');
  else warn('arecord ausente: transcrição pelo microfone não funciona', 'sudo apt install -y alsa-utils');

  const vosk = spawnSync('python3', ['-c', 'import vosk'], { stdio: 'ignore' });
  if (vosk.status === 0) ok('Python vosk (transcrição offline)');
  else warn('Python vosk ausente: transcrição offline desativada', 'pip install vosk   (ou num .venv na raiz)');

  if (has('ffmpeg', ['-version'])) ok('ffmpeg (gravações)');
  else warn('ffmpeg ausente', 'sudo apt install -y ffmpeg');

  if (has('tesseract')) ok('tesseract (OCR / tradução de tela)');
  else warn('tesseract ausente: OCR usa fallback mais lento', 'sudo apt install -y tesseract-ocr tesseract-ocr-por tesseract-ocr-eng');

  const wayland = Boolean(process.env.WAYLAND_DISPLAY);
  if (wayland ? has('grim', ['-h']) && has('slurp', ['-h']) : has('maim', ['--version'])) {
    ok(`Captura de área (${wayland ? 'grim + slurp' : 'maim'})`);
  } else {
    warn(
      'Ferramenta de captura de área ausente',
      wayland ? 'sudo apt install -y grim slurp' : 'sudo apt install -y maim'
    );
  }
}

// ---------------------------------------------------------------- summary
console.log('');
if (failures > 0) {
  console.log(red(`${failures} problema(s) impedem o app de rodar. Corrija os itens ✖ acima.`));
  process.exit(1);
}
console.log(green(`Tudo pronto. Rode: pnpm dev`) + (warnings ? yellow(`  (${warnings} recurso(s) opcional(is) ausente(s))`) : ''));
