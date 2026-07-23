import { useRef, useEffect, useState } from 'react';

interface SplitTextProps {
  text: string;
  className?: string;
  charClassName?: string;
  delay?: number;
  duration?: number;
  splitType?: 'chars' | 'words';
  threshold?: number;
  rootMargin?: string;
  textAlign?: string;
  tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'div';
  onLetterAnimationComplete?: () => void;
}

function splitText(text: string, type: 'chars' | 'words'): string[] {
  if (type === 'words') {
    return text.split(/(\s+)/).filter(Boolean);
  }
  // Use Array.from to properly handle CJK characters
  return Array.from(text);
}

const SplitText = ({
  text,
  className = '',
  charClassName = '',
  delay = 50,
  duration = 0.6,
  splitType = 'chars',
  threshold = 0.1,
  rootMargin = '-50px',
  textAlign = 'center',
  tag = 'div',
  onLetterAnimationComplete,
}: SplitTextProps) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null);
  const [isVisible, setIsVisible] = useState(false);

  const chars = splitText(text, splitType);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  // 最后一个字符播完后触发完成回调
  useEffect(() => {
    if (!isVisible || !onLetterAnimationComplete) return;
    const total = (chars.length - 1) * delay + duration * 1000;
    const timer = window.setTimeout(onLetterAnimationComplete, total);
    return () => window.clearTimeout(timer);
  }, [isVisible, chars.length, delay, duration, onLetterAnimationComplete]);

  const Tag = tag;

  // 单次状态翻转 + 逐字 transitionDelay 交错：整个动画只触发一次 React 渲染，
  // 逐字节奏由 CSS 在合成器侧调度，不受定时器/React 调度抖动影响
  return (
    <Tag
      ref={ref}
      className={`split-parent ${className}`}
      style={{
        textAlign: textAlign as React.CSSProperties['textAlign'],
        lineHeight: 1.2,
      }}
    >
      {chars.map((char, index) => (
        <span
          key={index}
          className={charClassName || undefined}
          style={{
            display: 'inline-block',
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
            transition: `opacity ${duration}s ease-out, transform ${duration}s ease-out`,
            transitionDelay: `${index * delay}ms`,
            minWidth: char === ' ' ? '0.3em' : undefined,
          }}
        >
          {char === ' ' ? '\u00A0' : char}
        </span>
      ))}
    </Tag>
  );
};

export default SplitText;
