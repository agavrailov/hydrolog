import { SyncIndicator } from './SyncIndicator';

interface Props {
  open: boolean;
  onClose: () => void;
  hoursSinceSync: number | null;
  onChangeFolder: () => void;
}

export function AppDrawer({ open, onClose, hoursSinceSync, onChangeFolder }: Props) {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.5)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.22s ease',
        }}
      />

      <div style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0,
        width: 260,
        zIndex: 201,
        background: 'var(--bg-elevated)',
        borderLeft: '1px solid var(--border-subtle)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s ease',
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-3) var(--space-4)',
      }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: 'var(--color-primary)', fontWeight: 700 }}>
            HydroLog
          </span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1, padding: 4 }}
            aria-label="Затвори менюто"
          >
            ✕
          </button>
        </div>

        {/* Sync status */}
        <div style={{ paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-2)', borderBottom: '1px solid var(--border-subtle)' }}>
          <SyncIndicator hoursSinceSync={hoursSinceSync} />
        </div>

        {/* Actions */}
        <button
          className="btn-ghost"
          onClick={() => { onChangeFolder(); onClose(); }}
          style={{ justifyContent: 'flex-start', textAlign: 'left' }}
        >
          📂 Смяна на папка
        </button>

        {/* Future items pinned to bottom */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-subtle)', paddingTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <button className="btn-ghost" disabled style={{ justifyContent: 'flex-start', textAlign: 'left', opacity: 0.35 }}>
            ⚙ Настройки
          </button>
          <button className="btn-ghost" disabled style={{ justifyContent: 'flex-start', textAlign: 'left', opacity: 0.35 }}>
            👤 Вход
          </button>
        </div>
      </div>
    </>
  );
}
