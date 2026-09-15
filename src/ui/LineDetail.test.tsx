import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { resetDb } from '../cache/db';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { createLine } from '../domain/line-service';
import { LineDetail } from './LineDetail';
import type { Vertex } from '../domain/types';

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

describe('<LineDetail />', () => {
  it('renders label, spacing, mode, vertices', async () => {
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

    render(<LineDetail lineId={line.id} onBack={() => {}} />);
    expect(await screen.findByText('L1')).toBeInTheDocument();
    // Vertices show both point indices
    expect(screen.getByText(/точка 1 /)).toBeInTheDocument();
    expect(screen.getByText(/точка 17 /)).toBeInTheDocument();
  });
});
