import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Streamdown } from 'streamdown';

/**
 * RevealText — Typewriter-style reveal for messages that arrive fully-formed.
 *
 * Reveals text character-by-character at the given speed using
 * requestAnimationFrame for smooth 60fps animation. Once complete,
 * calls onRevealComplete so the parent can advance to the next message.
 */

const REVEAL_CHARS_PER_SECOND = 350; // ChatGPT / Claude speed

interface RevealTextProps {
  content: string;
  onRevealComplete?: () => void;
}

export default memo(function RevealText({ content, onRevealComplete }: RevealTextProps) {
  const [displayLength, setDisplayLength] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const carryRef = useRef(0);
  const completedRef = useRef(false);
  const contentRef = useRef(content);
  contentRef.current = content;

  const onCompleteRef = useRef(onRevealComplete);
  onCompleteRef.current = onRevealComplete;

  useEffect(() => {
    completedRef.current = false;
    carryRef.current = 0;
    lastFrameRef.current = null;

    const tick = (timestamp: number) => {
      const prev = lastFrameRef.current ?? timestamp;
      const deltaMs = Math.max(16, timestamp - prev);
      lastFrameRef.current = timestamp;

      const budget = (REVEAL_CHARS_PER_SECOND * deltaMs) / 1000 + carryRef.current;
      const add = Math.floor(budget);
      carryRef.current = budget - add;

      setDisplayLength((prev) => {
        const next = Math.min(prev + add, contentRef.current.length);
        if (next >= contentRef.current.length && !completedRef.current) {
          completedRef.current = true;
          setTimeout(() => onCompleteRef.current?.(), 0);
        }
        return next;
      });

      if (!completedRef.current) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [content]); // restart animation if content changes

  const visibleText = content.slice(0, displayLength);

  return <Streamdown>{visibleText}</Streamdown>;
});
