import { useState } from 'react';
import type { WordImage } from './api/types.gen';

function ImageExample({ image }: { image: WordImage }) {
  const [failed, setFailed] = useState(false);
  return <figure className="word-image">
    {failed ? <p>L’immagine non è disponibile.</p> : <img src={image.imageUrl} alt={image.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>}
    <figcaption><strong>{image.title}</strong><a href={image.sourceUrl} target="_blank" rel="noreferrer">Wikipedia</a><a href={image.creditUrl} target="_blank" rel="noreferrer">Fonte, autore e licenza</a></figcaption>
  </figure>;
}

export function WordImages({ images }: { images?: WordImage[] }) {
  if (!images?.length) return null;
  return <section className="word-images" aria-label="Immagini di esempio"><div className="word-image-grid">{images.map(image => <ImageExample key={image.imageUrl} image={image}/>)}</div></section>;
}
