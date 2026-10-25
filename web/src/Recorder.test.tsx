import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Recorder } from './Recorder';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('keeps typing available when microphone access is denied', async () => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')) } });
  vi.stubGlobal('MediaRecorder', class {});
  render(<Recorder onText={vi.fn()} onStart={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Parla con Lumi' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('Puoi abilitarlo nel browser o scrivere qui');
  expect(screen.getByRole('button')).toBeEnabled();
});
it('stops microphone tracks if permission arrives after navigating away', async () => {
  let resolve!: (media: MediaStream) => void;
  const promise = new Promise<MediaStream>(r => { resolve = r; });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => promise) } });
  vi.stubGlobal('MediaRecorder', class {});
  const stop = vi.fn(); const { unmount } = render(<Recorder onText={vi.fn()} onStart={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Parla con Lumi' }));
  unmount(); resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await waitFor(() => expect(stop).toHaveBeenCalledOnce());
});
