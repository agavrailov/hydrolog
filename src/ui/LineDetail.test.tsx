import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { createLine, attachDeviceData } from '../domain/line-service';
import { addAnomaly } from '../domain/interpretation-service';
import { LineDetail } from './LineDetail';
import type { Vertex, Point } from '../domain/types';

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
});

function v(atPointIndex: number, lat: number, lon: number): Vertex {
  return {
    lat, lon, elevSource: 'none',
    hAccM: 6, hAccMethod: 'median-reported',
    sampleCount: 20, fixedAt: new Date(), atPointIndex,
  };
}

async function seedLine() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'x',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  const line = await createLine(sv.id, {
    pointCount: 17, pointSpacingM: 2, electrodeSpacingM: 5,
    mode: 'multi-frequency', dipoleOrientation: 'inline',
    vertices: [v(1, 42.32, 23.78), v(17, 42.32, 23.7804)],
  });
  return line;
}

describe('<LineDetail />', () => {
  it('renders label, spacing, mode, vertices', async () => {
    const line = await seedLine();
    render(<LineDetail lineId={line.id} />);
    expect(await screen.findByText('L1')).toBeInTheDocument();
    expect(screen.getByText(/точка 1 /)).toBeInTheDocument();
    expect(screen.getByText(/точка 17 /)).toBeInTheDocument();
  });

  it('shows no-data hint when points is empty', async () => {
    const line = await seedLine();
    render(<LineDetail lineId={line.id} />);
    expect(await screen.findByText('Профил от устройство')).toBeInTheDocument();
    expect(await screen.findByText(/Все още няма данни от устройство/)).toBeInTheDocument();
  });

  it('shows canvas when points are present', async () => {
    const line = await seedLine();
    const now = new Date();
    const onePoint: Point = {
      index: 1, offsetM: 0, lat: 42.32, lon: 23.78,
      elevSource: 'none', coordSource: 'interpolated',
      readings: [{ pass: 1, recordedAt: now, values: [0.1], groundingOk: true, electrodeTreatment: 'none' }],
      flags: [],
    };
    await attachDeviceData(line.id, {
      channelSetSnapshot: line.channelSetSnapshot,
      pointCount: 1,
      deviceStartPointIndex: 80,
      deviceLineNumber: '1',
      mode: 'multi-frequency',
      status: 'complete',
      points: [onePoint],
    });

    render(<LineDetail lineId={line.id} />);
    await screen.findByText('Профил от устройство');
    expect(await screen.findByLabelText('Матрица от измервания — цветова скала mV')).toBeInTheDocument();
  });

  it('shows anomaly in list and delete button after addAnomaly', async () => {
    const line = await seedLine();
    const now = new Date();
    const onePoint: Point = {
      index: 1, offsetM: 0, lat: 42.32, lon: 23.78,
      elevSource: 'none', coordSource: 'interpolated',
      readings: [{ pass: 1, recordedAt: now, values: [0.1], groundingOk: true, electrodeTreatment: 'none' }],
      flags: [],
    };
    await attachDeviceData(line.id, {
      channelSetSnapshot: line.channelSetSnapshot,
      pointCount: 1,
      deviceStartPointIndex: 80,
      deviceLineNumber: '1',
      mode: 'multi-frequency',
      status: 'complete',
      points: [onePoint],
    });
    await addAnomaly(line.id, {
      fromPoint: 1, toPoint: 1, fromChannel: 1, toChannel: 1,
      type: 'fracture-signature', confidence: 3,
    });

    render(<LineDetail lineId={line.id} />);
    expect(await screen.findByText(/fracture-signature/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Изтрий/i })).toBeInTheDocument();
  });
});
