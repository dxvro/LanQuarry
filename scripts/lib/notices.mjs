// Lizenzhinweise der mitgelieferten Fremdkomponenten.
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

// extras: [{ name, version, license, text }] für Node.js, WinSW usw.
export function formatNotices({ productName, packages, extras }) {
  const out = [];
  const rule = '='.repeat(78);
  out.push(`${productName} - Hinweise zu Komponenten von Drittanbietern`);
  out.push('');
  out.push('Dieses Paket enthält die folgenden Komponenten. Ihre Lizenzen gelten für die jeweilige Komponente.');
  out.push('Eclipse Temurin (Java) ist nicht enthalten; die Anwendung lädt es bei Bedarf selbst von adoptium.net');
  out.push('(Lizenz: GPL-2.0 mit Classpath-Ausnahme).');
  out.push('');
  const all = [...extras, ...packages];
  out.push('Übersicht');
  out.push('---------');
  for (const item of all) out.push(`${item.name} ${item.version} (${item.license})`);
  out.push('');
  for (const item of all) {
    out.push(rule);
    out.push(`${item.name} ${item.version} - ${item.license}`);
    out.push(rule);
    out.push(item.text === '' ? '(Die Komponente liefert keinen Lizenztext mit; Lizenz laut package.json.)' : item.text);
    out.push('');
  }
  return out.join('\n');
}
