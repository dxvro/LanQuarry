const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export const formatInt = (value: number): string => integer.format(value);

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${number.format(mb / 1024)} GB` : `${integer.format(mb)} MB`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${number.format(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${number.format(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${number.format(bytes / 1024)} KB`;
  return `${integer.format(bytes)} B`;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${number.format(value / 1_000_000)} Mio.`;
  if (value >= 1_000) return `${number.format(value / 1_000)} Tsd.`;
  return integer.format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? '–' : `${number.format(value)} %`;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'unter 1 Min';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} T ${hours} Std`;
  if (hours > 0) return `${hours} Std ${minutes} Min`;
  return `${minutes} Min`;
}

export function formatDateTime(value: string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' });
}

export function formatClock(value: number): string {
  return new Date(value).toLocaleTimeString('de-DE', { hour12: false });
}

export const plural = (count: number, one: string, many: string): string => `${formatInt(count)} ${count === 1 ? one : many}`;
