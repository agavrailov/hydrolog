import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockRoot } from '../test/mock-fs';
import { setRoot, clearRoot } from '../storage/fs';
import { getDb, resetDb } from '../cache/db';
import { setWakeLockAdapter } from '../hardware/wake-lock';
import { setGeolocationAdapter } from '../hardware/geolocation';
import { mockWakeLockAdapter, mockGeolocationAdapter } from '../test/mock-navigator';
import { setDownscaleAdapter } from '../domain/anchor-photo';
import { createSite } from '../domain/site-service';
import { createSurvey } from '../domain/survey-service';
import { LineCaptureScreen } from './LineCaptureScreen';

let geo: ReturnType<typeof mockGeolocationAdapter>;

async function tick() { return new Promise((r) => setTimeout(r, 0)); }

beforeEach(async () => {
  await resetDb();
  clearRoot();
  setRoot(createMockRoot());
  const wl = mockWakeLockAdapter();
  setWakeLockAdapter(wl.adapter);
  geo = mockGeolocationAdapter();
  setGeolocationAdapter(geo.adapter);
  setDownscaleAdapter(async (b) => b);
});

async function seedSurvey() {
  const site = await createSite({
    name: 'X', settlement: 'x', municipality: 'x', region: 'Софийска',
    centroid: { lat: 0, lon: 0 }, accessNotes: '', landUse: '',
    status: 'surveyed', tags: [],
  });
  const sv = await createSurvey(site.id, {
    startedAt: new Date(), timezone: 'Europe/Sofia', operator: 'Anton',
    deviceModel: 'PQWT-TC300', deviceSerial: 'x',
    precipLast48h: 'none', qualityFlag: 'good',
  });
  return { site, sv };
}

describe('<LineCaptureScreen /> — full field flow', () => {
  it('advances on form submit', async () => {
    const { sv } = await seedSurvey();
    const user = userEvent.setup();
    const { container } = render(<LineCaptureScreen surveyId={sv.id} onSaved={() => {}} onCancel={() => {}} />);

    // Check the form is there
    const form = container.querySelector('form') as HTMLFormElement;
    expect(form).toBeInTheDocument();

    // Submit the form directly
    await user.click(screen.getByRole('button', { name: /продължи/i }));

    // Check the result
    const step2Exists = await screen.queryByText(/стъпка 2/i);
    const formExists = container.querySelector('form');
    console.log('After click - step2:', !!step2Exists, 'form:', !!formExists);

    if (!step2Exists && formExists) {
      throw new Error('Form did not advance to step 2');
    }
  });

  it('captures params -> P1 -> anchor -> PN -> saves', async () => {
    const { sv } = await seedSurvey();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(<LineCaptureScreen surveyId={sv.id} onSaved={onSaved} onCancel={() => {}} />);

    // Step 1 — parameters (defaults pre-filled)
    expect(screen.getByText(/стъпка 1/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /продължи/i }));

    // Step 2 — P1 GPS
    await screen.findByText(/стъпка 2/i);
    await user.click(screen.getByRole('button', { name: /стартирай gps/i }));
    // Feed 3 discards + 5 real fixes
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32 + i * 1e-6, lon: 23.78 + i * 1e-6, accuracyM: 6 });
      await tick();
    }
    // Wait for the "продължи" button on this stage to become active
    const p1Continue = await screen.findByRole('button', { name: /продължи/i });
    await user.click(p1Continue);

    // Step 3 — anchor photo (upload)
    await screen.findByText(/стъпка 3/i);
    const input = screen.getByLabelText(/опорна снимка/i) as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2])], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(input, file);
    // Continue
    await user.click(await screen.findByRole('button', { name: /продължи/i }));

    // Step 4 — PN GPS
    await screen.findByText(/стъпка 4/i);
    await user.click(screen.getByRole('button', { name: /стартирай gps/i }));
    for (let i = 0; i < 3; i++) { geo.pushFix({ accuracyM: 50 }); await tick(); }
    for (let i = 0; i < 5; i++) {
      geo.pushFix({ lat: 42.32001 + i * 1e-6, lon: 23.7804 + i * 1e-6, accuracyM: 5 });
      await tick();
    }
    await user.click(await screen.findByRole('button', { name: /продължи/i }));

    // Step 5 — save
    await screen.findByText(/стъпка 5/i);
    await user.click(screen.getByRole('button', { name: /запиши профила/i }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const lineId = onSaved.mock.calls[0][0];
    const row = await getDb().lines.get(lineId);
    expect(row?.json.label).toBe('L1');
    expect(row?.json.vertices).toHaveLength(2);
    expect(row?.json.vertices[0].electrodeIndex).toBe(1);
    expect(row?.json.vertices[1].electrodeIndex).toBe(17);
    expect(row?.json.point1AnchorMediaId).toBeDefined();
  });

  it('shows the spacing-swap error when electrodeSpacingM <= pointSpacingM', async () => {
    const { sv } = await seedSurvey();
    const user = userEvent.setup();
    render(<LineCaptureScreen surveyId={sv.id} onSaved={() => {}} onCancel={() => {}} />);
    const eInput = screen.getByLabelText(/разстояние между електродите/i);
    await user.clear(eInput);
    await user.type(eInput, '2');
    // Continue should be disabled OR clicking should show an alert
    await user.click(screen.getByRole('button', { name: /продължи/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/разстоянието между електродите/i);
  });
});
