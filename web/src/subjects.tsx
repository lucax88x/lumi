import type { Subject } from './api/types.gen';

export const subjects: { id: Subject; label: string; hint: string }[] = [
  { id: 'italian', label: 'Italiano', hint: 'Scopriamo parole e frasi.' },
  { id: 'english', label: 'Inglese', hint: 'Impariamo l’inglese, con un aiuto in italiano.' },
];
export function subjectLabel(subject?: Subject) { return subjects.find(item => item.id === subject)?.label ?? 'Italiano'; }
export function SubjectPicker({ value, onChange, disabled = false }: { value: Subject; onChange: (subject: Subject) => void; disabled?: boolean }) {
  return <div className="subject-picker" role="group" aria-label="Scegli la materia">
    {subjects.map(subject => <button key={subject.id} type="button" className={`soft-button ${value === subject.id ? 'subject-selected' : ''}`} aria-pressed={value === subject.id} disabled={disabled} onClick={() => onChange(subject.id)}>{subject.label}</button>)}
  </div>;
}
