import type { Subject } from './api/types.gen';
import { familyID } from './portal-state';
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, LoaderCircle } from 'lucide-react';
import { transcribe } from './api/sdk.gen';
import { errorMessage } from './lib';

export function Recorder({ onText, onStart, onState, disabled = false, subject = 'italian' }: {
  onText: (text: string) => void; onStart: () => void; onState?: (state: boolean) => void; disabled?: boolean; subject?: Subject;
}) {
  const familyId = familyID();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const stopTracks = () => { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; clearInterval(timer.current); };
  useEffect(() => {
    alive.current = true;
    const hide = () => { if (document.hidden && recorder.current?.state === 'recording') recorder.current.stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; document.removeEventListener('visibilitychange', hide); if (recorder.current?.state === 'recording') recorder.current.stop(); stopTracks(); controller.current?.abort(); };
  }, []);
  async function start() {
    if (pending.current || recording || busy) return;
    pending.current = true; setBusy(true); setError(''); onStart();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Il microfono non è disponibile. Apri Lumi dal suo indirizzo HTTPS, oppure scrivi la domanda.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!alive.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined);
      recorder.current = rec; const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onerror = () => { stopTracks(); if (alive.current) { setError('La registrazione si è interrotta. Prova ancora.'); setRecording(false); onState?.(false); } };
      rec.onstop = async () => {
        stopTracks(); if (!alive.current) return;
        setRecording(false); onState?.(false); setBusy(true);
        controller.current = new AbortController();
        try {
          const blob = new Blob(chunks, { type: rec.mimeType });
          const { data } = await transcribe({ query: { subject }, path: { familyId: familyId }, body: { file: new File([blob], 'voce', { type: blob.type }) }, signal: controller.current.signal, throwOnError: true });
          if (alive.current) onText(data.text);
        } catch (e) { if (alive.current) setError(errorMessage(e)); }
        finally { if (alive.current) setBusy(false); }
      };
      rec.start(); setBusy(false); setRecording(true); setSeconds(0); onState?.(true);
      let elapsed = 0;
      timer.current = window.setInterval(() => { elapsed++; setSeconds(elapsed); if (elapsed >= 60 && rec.state === 'recording') rec.stop(); }, 1000);
    } catch (e) {
      stopTracks();
      if (alive.current) { setBusy(false); setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Per ascoltarti ho bisogno del microfono. Puoi abilitarlo nel browser o scrivere qui.' : errorMessage(e)); }
    } finally { pending.current = false; }
  }
  return <div className="recorder">
    <button type="button" className={`mic-button ${recording ? 'recording' : ''}`} disabled={disabled || busy} onClick={() => recording ? recorder.current?.stop() : void start()}>
      {busy ? <LoaderCircle className="spin" size={21}/> : recording ? <Square size={19} fill="currentColor"/> : <Mic size={22}/>}
      {busy ? 'Ti ascolto…' : recording ? `Ho finito · ${seconds}s` : 'Parla con Lumi'}
    </button>
    {error && <p role="alert" className="error-text">{error}</p>}
  </div>;
}
