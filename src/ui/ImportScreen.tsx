import { useState, useMemo, useEffect } from 'react';
import { labels } from './labels';
import { pickRootFolder } from '../storage/fs';
import { scanPqwtImportRoot, type PqwtLineCandidate, type PqwtImportScan } from '../domain/pqwt-import-scanner';
import { importPqwtIntoLine } from '../domain/pqwt-import-service';
import { useLines } from '../cache/hooks';

type RowStatus = 'idle' | 'importing' | 'ok' | 'error';
interface Row {
  candidate: PqwtLineCandidate;
  targetLineId: string;
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

export function ImportScreen({ surveyId, onDone, onCancel }: Props) {
  const [scan, setScan] = useState<PqwtImportScan | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = useLines(surveyId);

  const availableTargets = useMemo(
    () => (lines ?? []).filter((r) => r.json.deviceStartPointIndex === undefined),
    [lines],
  );

  useEffect(() => {
    if (!scan || rows.length === 0) return;
    setRows((prev) => prev.map((row) => {
      if (row.targetLineId) return row;
      const match = availableTargets.find((t) =>
        t.json.label === row.candidate.folderName ||
        t.json.deviceLineNumber === row.candidate.deviceLineLabel,
      );
      return match ? { ...row, targetLineId: match.id } : row;
    }));
  }, [scan, availableTargets]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await pickRootFolder();
      const s = await scanPqwtImportRoot(picked);
      setScan(s);
      setRows(s.candidates.map((c) => ({ candidate: c, targetLineId: '', status: 'idle' as RowStatus })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canStart = rows.length > 0 && rows.every((r) => r.targetLineId !== '');

  const onStart = async () => {
    setBusy(true);
    setError(null);
    for (let i = 0; i < rows.length; i++) {
      setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'importing' } : r));
      try {
        await importPqwtIntoLine({
          targetLineId: rows[i].targetLineId,
          candidate: rows[i].candidate,
        });
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'ok' } : r));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'error', message: msg } : r));
      }
    }
    setBusy(false);
  };

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
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--space-2)' }}>
            {l.confirmMandatoryHint}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 'var(--space-4)' }}>
            {l.verbatimHint}
          </p>

          <h2>{l.candidatesHeading}</h2>

          <div style={{ overflowX: 'auto' }}>
            <table className="import-table">
              <thead>
                <tr>
                  <th>{l.tableColFolder}</th>
                  <th>{l.tableColHeaderLabel}</th>
                  <th>{l.tableColMode}</th>
                  <th>{l.tableColPointCount}</th>
                  <th>{l.tableColBmps}</th>
                  <th>{l.tableColTarget}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.candidate.folderName}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{row.candidate.folderName}</td>
                    <td>{row.candidate.deviceLineLabel}</td>
                    <td>{row.candidate.depthRangeM}</td>
                    <td style={{ textAlign: 'right' }}>
                      {row.candidate.csvText.split(/\r?\n/).filter((x) => x.length > 0).length - 1}
                    </td>
                    <td>{bmpBadge(row.candidate)}</td>
                    <td>
                      <select
                        value={row.targetLineId}
                        onChange={(e) => setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, targetLineId: e.target.value } : r))}
                        disabled={row.status === 'importing' || row.status === 'ok'}
                      >
                        <option value="">{l.targetPickPlaceholder}</option>
                        {availableTargets.map((t) => (
                          <option key={t.id} value={t.id}>{t.json.label}</option>
                        ))}
                      </select>
                    </td>
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
            <button className="btn-primary" onClick={onStart} disabled={!canStart || busy}>
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
