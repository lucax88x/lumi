import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { transcribe } from './api/sdk.gen';
import { Recorder } from './Recorder';

vi.mock('./api/sdk.gen', () => ({ transcribe: vi.fn() }));

afterEach(() => { vi.clearAllMocks(); cleanup(); vi.unstubAllGlobals(); });
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

it('keeps stop available and sends English recordings with the selected subject for review', async () => {
  const stopTrack = vi.fn(); const onText = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) } });
  vi.stubGlobal('MediaRecorder', class {
    static isTypeSupported() { return true; }
    state = 'inactive'; mimeType = 'audio/webm';
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
  });
  vi.mocked(transcribe).mockResolvedValue({ data: { text: 'Che cosa significa dog?' } } as Awaited<ReturnType<typeof transcribe>>);
  render(<Recorder subject="english" onText={onText} onStart={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Parla con Lumi' }));
  const stop = await screen.findByRole('button', { name: /Ho finito/ });
  expect(stop).toBeEnabled();
  fireEvent.click(stop);
  await waitFor(() => expect(onText).toHaveBeenCalledWith('Che cosa significa dog?'));
  expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({ query: { subject: 'english' }, body: { file: expect.any(File) } }));
  expect(stopTrack).toHaveBeenCalled();
});
