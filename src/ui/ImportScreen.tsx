import { useState } from 'react';
import { labels } from './labels';
import { pickRootFolder } from '../storage/fs';
import { scanPqwtImportRoot, type PqwtLineCandidate, type PqwtImportScan } from '../domain/pqwt-import-scanner';
import { importPqwtAsNewLine } from '../domain/pqwt-import-service';

type RowStatus = 'idle' | 'importing' | 'ok' | 'error';
interface Row {
  candidate: PqwtLineCandidate;
  status: RowStatus;
  message?: string;
}

interface Props {
  surveyId: string;
  onDone: () => void;
  onCancel: () => void;
}

function bmpBadge(c: PqwtLineCandidate): string {
  const l = labels.import;
  const raw = !!c.rawBmp, proc = !!c.processedBmp;
  if (raw && proc) return l.bmpBoth;
  if (raw) return l.bmpRawOnly;
  if (proc) return l.bmpProcessedOnly;
  return l.bmpNone;
}

function pointCount(c: PqwtLineCandidate): number {
  return c.csvText.split(/\r?\n/).filter((x) => x.length > 0).length - 1;
}

export function ImportScreen({ surveyId, onDone, onCancel }: Props) {
  const [scan, setScan] = useState<PqwtImportScan | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPick = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await pickRootFolder();
      const s = await scanPqwtImportRoot(picked);
      setScan(s);
      setRows(s.candidates.map((c) => ({ candidate: c, status: 'idle' as RowStatus })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onStart = async () => {
    setBusy(true);
    setError(null);
    for (let i = 0; i < rows.length; i++) {
      setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'importing' } : r));
      try {
        await importPqwtAsNewLine({ surveyId, candidate: rows[i].candidate });
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'ok' } : r));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'error', message: msg } : r));
      }
    }
    setBusy(false);
  };

  const allDone = rows.length > 0 && rows.every((r) => r.status === 'ok' || r.status === 'error');
  const l = labels.import;

  return (
    <section>
      <h1>{l.title}</h1>
      {error && <div role="alert" className="alert alert--error">{error}</div>}

      {!scan && (
        <button className="btn-primary" onClick={onPick} disabled={busy}>
          {busy ? l.scanning : l.pickFolder}
        </button>
      )}

      {scan && rows.length === 0 && (
        <p className="loading-text">{l.noCandidates}</p>
      )}

      {scan && rows.length > 0 && (
        <>
          <h2>{l.candidatesHeading}</h2>

          <div style={{ overflowX: 'auto' }}>
            <table className="import-table">
              <thead>
                <tr>
                  <th>{l.tableColFolder}</th>
                  <th>{l.tableColMode}</th>
                  <th>{l.tableColPointCount}</th>
                  <th>{l.tableColBmps}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.candidate.folderName}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{row.candidate.folderName}</td>
                    <td>{row.candidate.depthRangeM}M</td>
                    <td style={{ textAlign: 'right' }}>{pointCount(row.candidate)}</td>
                    <td>{bmpBadge(row.candidate)}</td>
                    <td>
                      {row.status === 'importing' && <span style={{ color: 'var(--color-secondary)' }}>{l.importing}</span>}
                      {row.status === 'ok' && <span style={{ color: 'var(--color-success)' }}>✓ {l.importedOk}</span>}
                      {row.status === 'error' && <span style={{ color: 'var(--color-danger)' }}>{l.importedFail}: {row.message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {scan.skipped.length > 0 && (
            <>
              <h3 style={{ marginTop: 'var(--space-4)' }}>{l.skippedHeading}</h3>
              <ul style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {scan.skipped.map((s) => <li key={s.folderName}>{s.folderName}: {s.reason}</li>)}
              </ul>
            </>
          )}

          <div className="btn-row">
            <button className="btn-primary" onClick={onStart} disabled={busy || allDone}>
              {busy ? l.importing : l.startImport}
            </button>
            <button className="btn-secondary" onClick={onDone} disabled={busy}>{labels.common.back}</button>
            <button className="btn-ghost" onClick={onCancel} disabled={busy}>{labels.common.cancel}</button>
          </div>
        </>
      )}
    </section>
  );
}
