import { describe, expect, it } from 'vitest';
import { parseRoute, serverPath } from './router';

describe('parseRoute', () => {
  it('knows the screens', () => {
    expect(parseRoute('/')).toEqual({ name: 'overview' });
    expect(parseRoute('/new')).toEqual({ name: 'new' });
    expect(parseRoute('/servers/abc')).toEqual({ name: 'server', id: 'abc', tab: 'console' });
    expect(parseRoute('/servers/abc/mods')).toEqual({ name: 'server', id: 'abc', tab: 'mods' });
    expect(parseRoute('/servers/abc/store/')).toEqual({ name: 'server', id: 'abc', tab: 'store' });
  });

  it('rejects everything else', () => {
    for (const path of ['/servers', '/servers/abc/zzz', '/servers/abc/mods/x', '/api/servers', '/servers/%E0%A4%A']) {
      expect(parseRoute(path).name, path).toBe('not-found');
    }
  });

  it('builds paths that parse back', () => {
    expect(parseRoute(serverPath('a b/c', 'config'))).toEqual({ name: 'server', id: 'a b/c', tab: 'config' });
    expect(serverPath('x')).toBe('/servers/x');
  });
});
