import type { ReactNode } from 'react';
import { cx } from './ui';

// Required on every page: this is a fan-made tool for Minecraft servers, not a product of Mojang or Microsoft
export const DISCLAIMER = 'Kein offizielles Minecraft-Produkt. Nicht von Mojang oder Microsoft genehmigt oder mit ihnen verbunden.';

export function Disclaimer({ className }: { className?: string }): ReactNode {
  return <p className={cx('text-xs leading-snug text-faint', className)}>{DISCLAIMER}</p>;
}
