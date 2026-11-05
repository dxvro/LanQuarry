// Fehlertext für einen fehlgeschlagenen spawnSync-Aufruf (reine Logik).
// Beim Start-Fehler (EACCES, ENOENT, ...) gibt es weder Status noch stdout/stderr, nur result.error.
export function describeSpawnFailure(result) {
  const lines = [];
  if (result.error) {
    lines.push(`${result.error.message}${result.error.code ? ` (${result.error.code})` : ''}`);
  }
  if (result.signal) lines.push(`Beendet durch Signal ${result.signal}`);
  else if (result.status !== null && result.status !== undefined && result.status !== 0) lines.push(`Exit-Status ${result.status}`);
  for (const [label, value] of [['stdout', result.stdout], ['stderr', result.stderr]]) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text !== '') lines.push(`${label}:\n${text}`);
  }
  return lines.length > 0 ? lines.join('\n') : 'unbekannter Fehler (keine Ausgabe, kein Status)';
}
