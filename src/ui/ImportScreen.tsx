import { useState, useMemo, useEffect } from 'react';
import { labels } from './labels';
import { pickRootFolder } from '../storage/fs';
import { scanPqwtImportRoot, type PqwtLineCandidate, type PqwtImportScan } from '../domain/pqwt-import-scanner';
import { importPqwtIntoLine } from '../domain/pqwt-import-service';
import { useLines } from '../cache/hooks';

type RowStatus = 'idle' | 'importing' | 'ok' | 'error';
interface Row {
  candidate: PqwtLineCandidate;
  targetLineId: string;      // '' = no selection yet
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

  // Available target lines = lines that don't already have device data attached
  const availableTargets = useMemo(
    () => (lines ?? []).filter((r) => r.json.deviceStartPointIndex === undefined),
    [lines],
  );

  // Auto-suggest target when scan arrives or lines list changes
  useEffect(() => {
    if (!scan || rows.length === 0) return;
    setRows((prev) => prev.map((row) => {
      if (row.targetLineId) return row;
      // Prefer exact label match; else deviceLineNumber match
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
    // Serialise: one import at a time to avoid concurrent folder writes
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
    <section style={{ padding: 16, maxWidth: 900 }}>
      <h1>{l.title}</h1>
      {error && <div role="alert" style={{ color: 'crimson' }}>{error}</div>}

      {!scan && (
        <button onClick={onPick} disabled={busy}>{busy ? l.scanning : l.pickFolder}</button>
      )}

      {scan && rows.length === 0 && (
        <p>{l.noCandidates}</p>
      )}

      {scan && rows.length > 0 && (
        <>
          <p><small>{l.confirmMandatoryHint}</small></p>
          <p><small>{l.verbatimHint}</small></p>
          <h2>{l.candidatesHeading}</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColFolder}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColHeaderLabel}</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColMode}</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColPointCount}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColBmps}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}>{l.tableColTarget}</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.candidate.folderName}>
                  <td style={{ padding: '4px' }}>{row.candidate.folderName}</td>
                  <td style={{ padding: '4px' }}>{row.candidate.deviceLineLabel}</td>
                  <td style={{ padding: '4px', textAlign: 'right' }}>{row.candidate.depthRangeM}</td>
                  <td style={{ padding: '4px', textAlign: 'right' }}>
                    {row.candidate.csvText.split(/\r?\n/).filter((x) => x.length > 0).length - 1}
                  </td>
                  <td style={{ padding: '4px' }}>{bmpBadge(row.candidate)}</td>
                  <td style={{ padding: '4px' }}>
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
                  <td style={{ padding: '4px' }}>
                    {row.status === 'idle' && ''}
                    {row.status === 'importing' && l.importing}
                    {row.status === 'ok' && l.importedOk}
                    {row.status === 'error' && `${l.importedFail}: ${row.message}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {scan.skipped.length > 0 && (
            <>
              <h3>{l.skippedHeading}</h3>
              <ul>{scan.skipped.map((s) => <li key={s.folderName}>{s.folderName}: {s.reason}</li>)}</ul>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button onClick={onStart} disabled={!canStart || busy}>{busy ? l.importing : l.startImport}</button>
            <button onClick={onDone} disabled={busy}>{labels.common.back}</button>
            <button onClick={onCancel} disabled={busy}>{labels.common.cancel}</button>
          </div>
        </>
      )}
    </section>
  );
}
