import { useId } from 'react';

export type Mood = 'idle' | 'listening' | 'thinking' | 'speaking';
export function Avatar({ mood = 'idle', className = '' }: { mood?: Mood; className?: string }) {
  const id = useId().replaceAll(':', '');
  return <svg className={`lumi-avatar ${mood} ${className}`} viewBox="0 0 260 260" fill="none" role="img" aria-label={`Lumi${mood === 'listening' ? ' ti ascolta' : mood === 'thinking' ? ' sta pensando' : ''}`}>
    <defs>
      <radialGradient id={`${id}-glow`}><stop stopColor="#f5db73" stopOpacity=".45"/><stop offset="1" stopColor="#f5db73" stopOpacity="0"/></radialGradient>
      <linearGradient id={`${id}-body`} x1="110" y1="100" x2="150" y2="210" gradientUnits="userSpaceOnUse"><stop stopColor="#e9dcfa"/><stop offset="1" stopColor="#b8a0de"/></linearGradient>
      <linearGradient id={`${id}-light`} x1="118" y1="180" x2="140" y2="218" gradientUnits="userSpaceOnUse"><stop stopColor="#fff3ae"/><stop offset="1" stopColor="#f2d56e"/></linearGradient>
    </defs>
    <circle className="avatar-glow" cx="130" cy="174" r="85" fill={`url(#${id}-glow)`}/>
    <ellipse cx="130" cy="237" rx="37" ry="6" fill="#6e537f" opacity=".09"/>
    <g className="avatar-float">
      <g className="wing wing-left"><ellipse cx="89" cy="146" rx="30" ry="47" transform="rotate(-36 89 146)" fill="#faf9ff" stroke="#d9cdea" strokeWidth="2.5"/><path d="M69 121Q90 145 105 166" stroke="#e5dcef" strokeWidth="2.5" strokeLinecap="round"/></g>
      <g className="wing wing-right"><ellipse cx="171" cy="146" rx="30" ry="47" transform="rotate(36 171 146)" fill="#faf9ff" stroke="#d9cdea" strokeWidth="2.5"/><path d="M191 121Q170 145 155 166" stroke="#e5dcef" strokeWidth="2.5" strokeLinecap="round"/></g>
      <path d="M112 92Q107 64 94 58M147 92Q153 64 165 58" stroke="#847099" strokeWidth="4" strokeLinecap="round"/>
      <circle cx="92" cy="56" r="7" fill="#b8a0de"/><circle cx="167" cy="56" r="7" fill="#b8a0de"/>
      <ellipse cx="130" cy="162" rx="41" ry="55" fill={`url(#${id}-body)`}/>
      <path d="M92 181Q130 204 168 181C163 207 148 221 130 221C112 221 97 207 92 181Z" fill={`url(#${id}-light)`}/>
      <ellipse cx="130" cy="121" rx="51" ry="43" fill="#d9c6f0"/>
      <ellipse cx="111" cy="120" rx="5" ry="7" fill="#493458"/><ellipse cx="149" cy="120" rx="5" ry="7" fill="#493458"/>
      <circle cx="113" cy="118" r="1.7" fill="white"/><circle cx="151" cy="118" r="1.7" fill="white"/>
      <ellipse cx="98" cy="132" rx="9" ry="5" fill="#eea6b1" opacity=".65"/><ellipse cx="162" cy="132" rx="9" ry="5" fill="#eea6b1" opacity=".65"/>
      <path className="avatar-smile" d="M120 134Q130 145 140 134" stroke="#634877" strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M104 169Q95 174 91 168M156 169Q166 174 169 168" stroke="#aa90cd" strokeWidth="5" strokeLinecap="round"/>
      <path d="m130 177 2 5 5 1-4 3 1 5-4-3-4 3 1-5-4-3 5-1Z" fill="#fff8d5"/>
    </g>
    <g className="avatar-sparkles" fill="#d9b85f"><path d="m43 91 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/><path d="m215 164 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z"/><circle cx="199" cy="81" r="3"/><circle cx="52" cy="185" r="2.5"/></g>
  </svg>;
}
