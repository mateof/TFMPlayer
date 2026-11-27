import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useSeekDrag } from './useSeekDrag';

function Bar({ position, seek }: { position: number; seek: (s: number) => void }) {
  const bar = useSeekDrag(position, seek);
  return (
    <>
      <input type="range" min={0} max={100} step="any" aria-label="seek" {...bar.inputProps} />
      <span data-testid="time">{bar.value}</span>
    </>
  );
}

describe('useSeekDrag', () => {
  it('seeks once, on release, while showing the drag target', () => {
    const seek = vi.fn();
    const { getByLabelText, getByTestId } = render(<Bar position={10} seek={seek} />);
    const input = getByLabelText('seek');
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.change(input, { target: { value: '35' } });
    fireEvent.change(input, { target: { value: '50' } });
    expect(seek).not.toHaveBeenCalled();
    expect(getByTestId('time').textContent).toBe('50');
    fireEvent.pointerUp(window);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(50);
  });

  it('keeps the target on screen until playback gets there', () => {
    const seek = vi.fn();
    const { getByLabelText, getByTestId, rerender } = render(<Bar position={10} seek={seek} />);
    const input = getByLabelText('seek');
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.pointerUp(window);
    expect(getByTestId('time').textContent).toBe('60');
    rerender(<Bar position={60.2} seek={seek} />);
    expect(getByTestId('time').textContent).toBe('60.2');
  });

  it('seeks at once without a pointer (keyboard)', () => {
    const seek = vi.fn();
    const { getByLabelText } = render(<Bar position={10} seek={seek} />);
    fireEvent.change(getByLabelText('seek'), { target: { value: '15' } });
    expect(seek).toHaveBeenCalledWith(15);
  });
});
