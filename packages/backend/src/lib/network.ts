import os from 'node:os';

export function getLanUrls(port: number, interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const urls: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      // family is a string in current Node, but older versions reported the number 4
      const isIPv4 = entry.family === 'IPv4' || (entry.family as string | number) === 4;
      if (isIPv4 && !entry.internal) urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}
