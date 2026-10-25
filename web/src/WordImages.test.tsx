import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WordImages } from './WordImages';

const image = { title: 'Roccia', imageUrl: 'https://upload.wikimedia.org/rock.jpg', sourceUrl: 'https://it.wikipedia.org/wiki/Roccia', creditUrl: 'https://it.wikipedia.org/wiki/File:Rock.jpg' };
afterEach(cleanup);
it('keeps attribution when the image cannot load', () => {
  render(<WordImages images={[image]}/>);
  expect(screen.getByRole('img', { name: 'Roccia' })).toHaveAttribute('referrerpolicy', 'no-referrer');
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByText('L’immagine non è disponibile.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Fonte, autore e licenza' })).toHaveAttribute('href', image.creditUrl);
});
it('does not show a search form or an empty gallery', () => {
  const { container } = render(<WordImages/>);
  expect(container).toBeEmptyDOMElement();
});
