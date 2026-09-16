import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnomalyForm } from './AnomalyForm';

const defaults = { pointCount: 17, channelCount: 36 };

describe('<AnomalyForm />', () => {
  it('renders from/to point and channel inputs', () => {
    render(<AnomalyForm {...defaults} onSubmit={vi.fn()} />);
    expect(screen.getByLabelText('От точка')).toBeInTheDocument();
    expect(screen.getByLabelText('До точка')).toBeInTheDocument();
    expect(screen.getByLabelText('От канал')).toBeInTheDocument();
    expect(screen.getByLabelText('До канал')).toBeInTheDocument();
  });

  it('renders type select with all AnomalyType options', () => {
    render(<AnomalyForm {...defaults} onSubmit={vi.fn()} />);
    expect(screen.getByText('Сигнатура на пукнатина')).toBeInTheDocument();
    expect(screen.getByText('Шумов артефакт')).toBeInTheDocument();
  });

  it('calls onSubmit with correct values when form is submitted', () => {
    const onSubmit = vi.fn();
    render(<AnomalyForm {...defaults} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /Добави/i }));
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
    render(<AnomalyForm {...defaults} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: /Добави/i }));
    expect(onSubmit.mock.calls[0][0].note).toBeUndefined();
  });
});
