import { useId } from 'react';
import { BookOpen, Check, Languages, Landmark, Map, Shapes, Sprout } from 'lucide-react';
import type { Subject } from './api/types.gen';

export const subjects: { id: Subject; label: string; hint: string; example: string }[] = [
  { id: 'italian', label: 'Italiano', hint: 'Scopriamo parole e frasi.', example: 'Per esempio: cosa vuol dire «meraviglia»?' },
  { id: 'english', label: 'Inglese', hint: 'Impariamo l’inglese, con un aiuto in italiano.', example: 'Per esempio: come si dice «cane»?' },
  { id: 'history', label: 'Storia', hint: 'Scopriamo come si viveva tanto tempo fa.', example: 'Per esempio: vorrei scoprire gli Egiziani.' },
  { id: 'geography', label: 'Geografia', hint: 'Esploriamo luoghi e paesaggi.', example: 'Per esempio: dove si trova il Nilo?' },
  { id: 'science', label: 'Scienze', hint: 'Scopriamo la natura, un passo alla volta.', example: 'Per esempio: come nasce la pioggia?' },
  { id: 'geometry', label: 'Geometria', hint: 'Guardiamo insieme forme e angoli.', example: 'Per esempio: spiegami l’angolo retto.' },
];
export function subjectLabel(subject?: Subject) { return subjects.find(item => item.id === subject)?.label ?? 'Italiano'; }
const subjectIcons = { italian: BookOpen, english: Languages, history: Landmark, geography: Map, science: Sprout, geometry: Shapes };

export function SubjectPicker({ value, onChange, disabled = false, only }: { only?: Subject[]; value: Subject; onChange: (subject: Subject) => void; disabled?: boolean }) {
  const name = useId();
  return <div className="subject-picker" role="radiogroup" aria-label="Scegli la materia">
    {subjects.filter(subject => !only || only.includes(subject.id)).map(subject => {
      const Icon = subjectIcons[subject.id];
      return <label key={subject.id} className="subject-option">
        <input type="radio" name={name} value={subject.id} checked={value === subject.id} disabled={disabled} onChange={() => onChange(subject.id)}/>
        <Icon className="subject-icon" size={22} strokeWidth={1.7} aria-hidden="true"/>
        <span className="subject-name">{subject.label}</span>
        <span className="subject-check" aria-hidden="true"><Check size={12} strokeWidth={3}/></span>
      </label>;
    })}
  </div>;
}
