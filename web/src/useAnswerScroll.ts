import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Message } from './api/types.gen';

// Follow the beginning of an answer, never its growing bottom edge.
export function useAnswerScroll(conversationId: string | undefined, messages: Message[]) {
  const readingArea = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const expectedTop = useRef(0);
  const [showLatest, setShowLatest] = useState(false);

  function articleFor(area: HTMLElement, id?: string) {
    return [...area.querySelectorAll<HTMLElement>('[data-message-id]')].find(article => article.dataset.messageId === id);
  }

  function updateVisibility() {
    const area = readingArea.current;
    if (!area) return;
    const answer = articleFor(area, [...messages].reverse().find(message => message.role === 'assistant')?.id);
    const viewport = area.getBoundingClientRect();
    const bounds = answer?.getBoundingClientRect();
    setShowLatest(Boolean(bounds && (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom)));
  }

  function alignLatest() {
    const area = readingArea.current;
    if (!area) return;
    const article = articleFor(area, messages.at(-1)?.id);
    if (following.current && article) {
      area.scrollTop += article.getBoundingClientRect().top - area.getBoundingClientRect().top - 8;
      expectedTop.current = area.scrollTop;
    }
    updateVisibility();
  }

  useLayoutEffect(() => {
    following.current = true;
    expectedTop.current = 0;
  }, [conversationId]);

  useLayoutEffect(() => {
    alignLatest();
    const area = readingArea.current;
    if (!area || typeof ResizeObserver === 'undefined') return;
    // Includes delayed images, the waiting scene disappearing, and keyboard resizing.
    const observer = new ResizeObserver(alignLatest);
    observer.observe(area);
    const content = area.querySelector('.messages');
    if (content) observer.observe(content);
    return () => observer.disconnect();
  });

  function stopFollowing() { following.current = false; }

  function onScroll() {
    const area = readingArea.current;
    if (area && Math.abs(area.scrollTop - expectedTop.current) > 1) stopFollowing();
    updateVisibility();
  }

  function revealLatest() {
    const area = readingArea.current;
    if (!area) return;
    const answer = articleFor(area, [...messages].reverse().find(message => message.role === 'assistant')?.id);
    following.current = true;
    if (answer) {
      area.scrollTop += answer.getBoundingClientRect().top - area.getBoundingClientRect().top - 8;
      expectedTop.current = area.scrollTop;
    }
    updateVisibility();
  }

  function prepareAnswer() {
    following.current = true;
    setShowLatest(false);
  }

  return { readingArea, showLatest, revealLatest, prepareAnswer, readingEvents: {
    onScroll,
    onWheel: stopFollowing,
    onTouchMove: stopFollowing,
    onPointerDown: stopFollowing,
    onClickCapture: stopFollowing,
    onKeyDown: (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Enter', 'Tab'].includes(event.key)) stopFollowing();
    },
  } };
}
