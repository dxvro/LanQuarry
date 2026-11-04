// Stand-in for a Minecraft server, started with `node fake-server.mjs <java args...>` by the fake spawner.
import { createInterface } from 'node:readline';
import { appendFileSync, writeFileSync } from 'node:fs';

const mode = process.env.FAKE_MODE ?? 'normal';
const format = process.env.FAKE_FORMAT ?? 'vanilla';
const startDelay = Number(process.env.FAKE_START_DELAY ?? 30);
const marker = process.env.FAKE_MARKER ?? '';

writeFileSync('fake-args.json', JSON.stringify({ args: process.argv.slice(2), pid: process.pid, marker }));

const note = (text) => {
  if (process.env.FAKE_EVENTS_FILE) appendFileSync(process.env.FAKE_EVENTS_FILE, `${new Date().toISOString()} ${text}\n`);
};
note(`started pid ${process.pid} mode ${mode}`);
process.on('exit', (code) => note(`exit ${code}`));

const log = (message, level = 'INFO') =>
  format === 'ansi'
    ? `\x1b[0;37m[12:00:00 \x1b[32m${level}\x1b[0;37m]\x1b[m: ${message}\x1b[m`
    : format === 'paper'
      ? `[12:00:00 ${level}]: ${message}`
      : format === 'forge'
        ? `[12:00:00] [Server thread/${level}] [net.minecraft.server.dedicated.DedicatedServer/]: ${message}`
        : `[12:00:00] [Server thread/${level}]: ${message}`;
const out = (message, level) => process.stdout.write(`${log(message, level)}\n`);

out('Starting minecraft server version 1.21.1');

if (mode === 'crash-early') {
  setTimeout(() => {
    out('Failed to start the server', 'ERROR');
    process.exit(3);
  }, startDelay);
} else if (mode !== 'silent') {
  setTimeout(() => {
    out('Done (1.234s)! For help, type "help"');
    if (mode === 'crash') {
      setTimeout(() => {
        out('Exception in server tick loop', 'ERROR');
        process.exit(1);
      }, 120);
    }
  }, startDelay);
}

if (mode === 'ctrlc') {
  process.on('SIGINT', () => {
    note('SIGINT received');
    out('Stopping the server (Ctrl+C)');
    setTimeout(() => process.exit(0), 50);
  });
}

if (mode === 'busy') {
  const end = Date.now() + 120_000;
  setImmediate(function spin() {
    if (Date.now() < end) {
      for (let i = 0; i < 2e6; i++);
      setImmediate(spin);
    }
  });
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [command, ...rest] = line.split(' ');
  const text = rest.join(' ');
  switch (command) {
    case 'stop':
      note('stop command received');
      if (mode === 'ignore-stop') return;
      out('Stopping the server');
      out('Saving worlds');
      setTimeout(() => process.exit(0), 40);
      break;
    case 'say':
      out(`[Server] ${text}`);
      break;
    case 'join':
      out(`${text} joined the game`);
      break;
    case 'leave':
      out(`${text} left the game`);
      break;
    case 'chat':
      out(`<${text.split(' ')[0]}> ${rest.slice(1).join(' ')}`);
      break;
    case 'stderr':
      process.stderr.write(`${text}\n`);
      break;
    case 'crlf':
      process.stdout.write('crlf one\r\ncrlf two\r\n');
      break;
    case 'utf8': {
      const bytes = Buffer.from('Grüße ☃ 😀 fertig\n', 'utf8');
      for (let i = 0; i < bytes.length; i++) process.stdout.write(bytes.subarray(i, i + 1));
      break;
    }
    case 'long':
      process.stdout.write(`${'x'.repeat(20_000)}\n`);
      break;
    case 'raw':
      process.stdout.write(`${text}\n`);
      break;
    case 'exit':
      process.exit(Number(text || 0));
      break;
    default:
      out(`Unknown command: ${line}`);
  }
});
rl.on('close', () => {
  if (mode === 'exit-on-eof') process.exit(0);
});
