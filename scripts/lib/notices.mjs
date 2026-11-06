// License notices of the bundled third-party components.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const LICENSE_FILE = /^(licen[sc]e|copying|notice)(\.(md|txt))?$/i;

function licenseName(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(' OR ');
  return 'UNLICENSED';
}

async function packageDirs(nodeModules) {
  const result = [];
  for (const entry of await readdir(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(path.join(nodeModules, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory()) result.push(path.join(nodeModules, entry.name, scoped.name));
      }
    } else {
      result.push(path.join(nodeModules, entry.name));
    }
  }
  return result;
}

export async function collectPackages(nodeModules) {
  const packages = [];
  for (const dir of await packageDirs(nodeModules)) {
    let pkg;
    try {
      pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const files = (await readdir(dir)).filter((name) => LICENSE_FILE.test(name)).sort();
    const texts = [];
    for (const name of files) texts.push((await readFile(path.join(dir, name), 'utf8')).trim());
    packages.push({ name: pkg.name ?? path.basename(dir), version: pkg.version ?? '?', license: licenseName(pkg), text: texts.join('\n\n') });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}

// extras: [{ name, version, license, text }] for Node.js, WinSW etc.
export function formatNotices({ productName, packages, extras }) {
  const out = [];
  const rule = '='.repeat(78);
  out.push(`${productName} - Notices for third-party components`);
  out.push('');
  out.push('This package contains the following components. Their licenses apply to the respective component.');
  out.push('Eclipse Temurin (Java) is not included; the application downloads it from adoptium.net itself when needed');
  out.push('(license: GPL-2.0 with Classpath Exception).');
  out.push('');
  const all = [...extras, ...packages];
  out.push('Overview');
  out.push('--------');
  for (const item of all) out.push(`${item.name} ${item.version} (${item.license})`);
  out.push('');
  for (const item of all) {
    out.push(rule);
    out.push(`${item.name} ${item.version} - ${item.license}`);
    out.push(rule);
    out.push(item.text === '' ? '(The component does not ship a license text; license according to package.json.)' : item.text);
    out.push('');
  }
  return out.join('\n');
}
