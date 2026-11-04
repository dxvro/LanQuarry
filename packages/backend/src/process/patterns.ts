// Server log lines look like
//   vanilla/Fabric  [12:00:00] [Server thread/INFO]: message
//   Forge/NeoForge  [12:00:00] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer/]: message
//   Paper           [12:00:00 INFO]: message
//   Fabric (logger) [12:00:00] [Server thread/INFO] (Minecraft) message   (the colon after the logger is optional)
// The patterns are anchored at the log prefix and at the start of the message, so a chat line such as
// "<Bob> Done (1.0s)! For help" or "[Server] Steve joined the game" can never match.

const TIME = String.raw`(?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?`;
const LEVEL = String.raw`(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)`;

const VANILLA_PREFIX = String.raw`\[${TIME}\] \[[^\]\r\n/]{1,64}/${LEVEL}\](?: \[[^\]\r\n]{0,200}\])*(?:: | \([^)\r\n]{0,100}\):? )`;
const PAPER_PREFIX = String.raw`\[${TIME} ${LEVEL}\]: `;
const PREFIX = `(?:${VANILLA_PREFIX}|${PAPER_PREFIX})`;
const NAME = String.raw`[A-Za-z0-9_.]{1,32}`;

const DONE = new RegExp(String.raw`^${PREFIX}Done \(\d+(?:[.,]\d+)?s\)! For help, type "help"(?: or "\?")?$`);
const JOINED = new RegExp(String.raw`^${PREFIX}(${NAME}) joined the game$`);
const LEFT = new RegExp(String.raw`^${PREFIX}(${NAME}) left the game$`);

export type LineEvent = { type: 'done' } | { type: 'join'; name: string } | { type: 'leave'; name: string };

export function classifyLine(line: string): LineEvent | null {
  if (line.length > 400) return null;
  if (DONE.test(line)) return { type: 'done' };
  const joined = JOINED.exec(line)?.[1];
  if (joined !== undefined) return { type: 'join', name: joined };
  const left = LEFT.exec(line)?.[1];
  if (left !== undefined) return { type: 'leave', name: left };
  return null;
}
