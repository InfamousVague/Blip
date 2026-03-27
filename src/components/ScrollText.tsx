import { useRef, useEffect, useState } from "react";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import "@mattmattmattmatt/base/primitives/text/text.css";

type TextProps = React.ComponentProps<typeof Text>;

interface ScrollTextProps extends TextProps {
  children: string;
}

/**
 * Text that auto-scrolls back and forth when it overflows its container.
 */
export function ScrollText({ children, ...textProps }: ScrollTextProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [containerWidth, setContainerWidth] = useState(200);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const check = () => {
      const cw = container.offsetWidth;
      const tw = text.scrollWidth;
      setOverflows(tw > cw);
      setContainerWidth(cw);
    };

    check();
    const observer = new ResizeObserver(check);
    observer.observe(container);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div
      ref={containerRef}
      className={`text-scroll${overflows ? " text-scroll--active" : ""}`}
      style={{ "--scroll-container-width": `${containerWidth}px` } as React.CSSProperties}
    >
      <span ref={textRef} className="text-scroll__inner">
        <Text {...textProps}>{children}</Text>
      </span>
    </div>
  );
}
