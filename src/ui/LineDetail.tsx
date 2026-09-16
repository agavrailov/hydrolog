import { useEffect, useState } from 'react';
import { labels } from './labels';
import { useLine, useLineMedia } from '../cache/hooks';
import { ProfileCanvas } from './ProfileCanvas';
import { getPath } from '../storage/paths';
import { readBlob } from '../storage/atomic';
import { getRoot } from '../storage/fs';

interface Props {
  lineId: string;
  onBack: () => void;
}

function useBmpUrls(storagePaths: string[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  const key = storagePaths.join('|');

  useEffect(() => {
    if (storagePaths.length === 0) {
      setUrls([]);
      return;
    }
    let revoked = false;
    const created: string[] = [];

    (async () => {
      try {
        const root = getRoot();
        const loaded: string[] = [];
        for (const sp of storagePaths) {
          const parts = sp.split('/');
          const fileName = parts.pop()!;
          const dir = await getPath(root, parts);
          if (!dir) continue;
          const blob = await readBlob(dir, fileName);
          const url = URL.createObjectURL(blob);
          created.push(url);
          loaded.push(url);
        }
        if (!revoked) setUrls(loaded);
      } catch {
        // root not set or file missing — show nothing silently
      }
    })();

    return () => {
      revoked = true;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return urls;
}

export function LineDetail({ lineId, onBack }: Props) {
  const row = useLine(lineId);
  const media = useLineMedia(lineId);

  const deviceScreenPaths = (media ?? [])
    .filter((m) => m.json.kind === 'device-screen')
    .map((m) => m.storagePath);

  const bmpUrls = useBmpUrls(deviceScreenPaths);

  if (!row) return <p>{labels.common.loading}</p>;
  const l = row.json;
  const ll = labels.line;
  const pl = labels.profile;

  return (
    <section style={{ padding: 16, maxWidth: 720 }}>
      <button onClick={onBack}>{labels.common.back}</button>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h1 style={{ margin: 0 }}>{l.label}</h1>
        <code>{ll.title}</code>
      </header>

      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>{ll.fields.pointCount}</dt><dd>{l.pointCount}</dd>
        <dt>{ll.fields.pointSpacingM}</dt><dd>{l.pointSpacingM}</dd>
        <dt>{ll.fields.electrodeSpacingM}</dt><dd>{l.electrodeSpacingM}</dd>
        <dt>{ll.fields.mode}</dt><dd>{ll.modeOptions[l.mode]}</dd>
        <dt>{ll.fields.dipoleOrientation}</dt><dd>{ll.dipoleOptions[l.dipoleOrientation]}</dd>
        {l.lengthM != null && (<><dt>{ll.lengthM}</dt><dd>{l.lengthM.toFixed(2)} m</dd></>)}
      </dl>

      <h2>{ll.verticesFixed}</h2>
      <ul>
        {l.vertices.map((v, i) => (
          <li key={i}>
            точка {v.atPointIndex} · {v.lat.toFixed(6)}, {v.lon.toFixed(6)} · hAccM {v.hAccM.toFixed(1)} m · {v.sampleCount} проби
          </li>
        ))}
      </ul>

      <h2>{pl.heading}</h2>
      {l.points.length === 0 ? (
        <p>{pl.noData}</p>
      ) : (
        <>
          <ProfileCanvas points={l.points} channelSet={l.channelSetSnapshot} />
          {bmpUrls.length > 0 && (
            <>
              <h3>{pl.deviceScreens}</h3>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
                {bmpUrls.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`${pl.deviceScreens} ${i + 1}`}
                    style={{ maxHeight: 240, objectFit: 'contain' }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
