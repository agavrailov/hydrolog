import type { FC } from 'react';
import { nagLevel } from '../storage/sync';

interface Props {
  hoursSinceSync: number | null;
}

const COLORS: Record<ReturnType<typeof nagLevel>, string> = {
  ok: '#2b7',
  amber: '#e90',
  red: '#c22',
};

export const SyncIndicator: FC<Props> = ({ hoursSinceSync }) => {
  const level = nagLevel(hoursSinceSync);
  const label = hoursSinceSync === null
    ? 'never synced'
    : `${hoursSinceSync.toFixed(1)} h since sync`;
  return (
    <div
      data-testid="sync-indicator"
      data-nag={level}
      style={{
        display: 'inline-block',
        padding: '4px 8px',
        borderRadius: 4,
        color: 'white',
        background: COLORS[level],
        fontSize: 12,
      }}
    >
      {label}
    </div>
  );
};
