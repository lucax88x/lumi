import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SubjectPicker } from './subjects';

afterEach(cleanup);

it('disables every subject during recording or generation and preserves the selection', () => {
  render(<SubjectPicker value="science" onChange={vi.fn()} disabled/>);
  for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'Scienze' })).toBeChecked();
});

it('keeps separate pickers independent and limits dictionary choices', () => {
  render(<>
    <SubjectPicker value="science" onChange={vi.fn()}/>
    <SubjectPicker value="english" onChange={vi.fn()} only={['italian', 'english']}/>
  </>);
  const [allSubjects, dictionary] = screen.getAllByRole('radiogroup', { name: 'Scegli la materia' });
  expect(within(allSubjects).getAllByRole('radio')).toHaveLength(6);
  expect(within(dictionary).getAllByRole('radio')).toHaveLength(2);
  const science = within(allSubjects).getByRole('radio', { name: 'Scienze' });
  const english = within(dictionary).getByRole('radio', { name: 'Inglese' });
  expect(science).toBeChecked();
  expect(english).toBeChecked();
  expect(science.getAttribute('name')).not.toBe(english.getAttribute('name'));
});
