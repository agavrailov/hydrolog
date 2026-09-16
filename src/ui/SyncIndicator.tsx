import type { FC } from 'react';
import { nagLevel } from '../storage/sync';

interface Props {
  hoursSinceSync: number | null;
}

export const SyncIndicator: FC<Props> = ({ hoursSinceSync }) => {
  const level = nagLevel(hoursSinceSync);
  const warn = level !== 'ok';
  const text = hoursSinceSync === null
    ? 'без синхрон'
    : `${Math.round(hoursSinceSync)}г без синхрон`;

  return (
    <span
      data-testid="sync-indicator"
      data-nag={level}
      className={`sync-indicator${warn ? ' sync-indicator--warn' : ''}`}
    >
      {warn ? '⚠ ' : ''}{text}
    </span>
  );
};
