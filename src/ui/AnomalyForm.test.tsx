import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnomalyForm } from './AnomalyForm';
import type { ChannelSetSnapshot } from '../domain/types';

function makeChannelSet(n = 36, maxDepthM = 150): ChannelSetSnapshot {
  const step = maxDepthM / n;
  return {
    name: 'test', deviceModel: 'PQWT-TC300', kind: 'frequency', units: 'mV',
    depthModel: 'linear-nominal', provenanceNote: 'test',
    frozenAt: new Date(),
    channels: Array.from({ length: n }, (_, i) => ({
      label: `ch${i + 1}`, order: i, pseudoDepthM: (i + 1) * step,
    })),
  };
}

const channelSet = makeChannelSet();
const defaults = { pointCount: 17, channelSet };

describe('<AnomalyForm />', () => {
  it('renders from/to point and depth inputs', () => {
    render(<AnomalyForm {...defaults} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('От точка')).toBeInTheDocument();
    expect(screen.getByLabelText('До точка')).toBeInTheDocument();
    expect(screen.getByLabelText('От дълбочина (m)')).toBeInTheDocument();
    expect(screen.getByLabelText('До дълбочина (m)')).toBeInTheDocument();
  });

  it('renders type select with all AnomalyType options', () => {
    render(<AnomalyForm {...defaults} onSubmit={vi.fn()} />);
    expect(screen.getByText('Сигнатура на пукнатина')).toBeInTheDocument();
    expect(screen.getByText('Шумов артефакт')).toBeInTheDocument();
  });

  it('calls onSubmit with correct values when form is submitted', () => {
    const onSubmit = vi.fn();
    const { container } = render(<AnomalyForm {...defaults} onSubmit={onSubmit} />);
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledOnce();
    const arg = onSubmit.mock.calls[0][0];
    expect(arg.fromPoint).toBeGreaterThanOrEqual(1);
    expect(arg.toPoint).toBeGreaterThanOrEqual(arg.fromPoint);
    expect(arg.fromChannel).toBeGreaterThanOrEqual(1);
    expect(arg.toChannel).toBeGreaterThanOrEqual(arg.fromChannel);
    expect(arg.type).toBeTruthy();
    expect(arg.confidence).toBeGreaterThanOrEqual(1);
    expect(arg.confidence).toBeLessThanOrEqual(5);
  });

  it('note is trimmed and omitted when empty', () => {
    const onSubmit = vi.fn();
    const { container } = render(<AnomalyForm {...defaults} onSubmit={onSubmit} />);
    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit.mock.calls[0][0].note).toBeUndefined();
  });
});
