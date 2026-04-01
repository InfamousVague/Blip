import { useRef, useEffect, useState } from "react";
import type { CSSProperties } from "react";

interface ScrollTextProps {
  children: string;
  size?: "xs" | "sm" | "base" | "md" | "lg" | "xl" | "2xl";
  color?: "primary" | "secondary" | "tertiary";
  weight?: "regular" | "medium" | "semibold" | "bold";
  font?: "mono" | "sans";
  truncate?: number;
  style?: CSSProperties;
}

const SIZE_MAP: Record<string, number> = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 15,
  lg: 18,
  xl: 22,
  "2xl": 28,
};

const COLOR_MAP: Record<string, string> = {
  primary: "var(--blip-text-primary)",
  secondary: "var(--blip-text-secondary)",
  tertiary: "var(--blip-text-tertiary)",
};

const WEIGHT_MAP: Record<string, number> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/**
 * Text that auto-scrolls back and forth when it overflows its container.
 */
export function ScrollText({ children, size, color, weight, font, truncate, style: extraStyle }: ScrollTextProps) {
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

  const spanStyle: CSSProperties = {
    fontSize: size ? SIZE_MAP[size] : undefined,
    color: color ? COLOR_MAP[color] : undefined,
    fontWeight: weight ? WEIGHT_MAP[weight] : undefined,
    fontFamily: font === "mono" ? "var(--font-mono)" : "var(--font-sans)",
    ...(truncate ? { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const } : {}),
    ...extraStyle,
  };

  return (
    <div
      ref={containerRef}
      className={`text-scroll${overflows ? " text-scroll--active" : ""}`}
      style={{ "--scroll-container-width": `${containerWidth}px` } as React.CSSProperties}
    >
      <span ref={textRef} className="text-scroll__inner">
        <span style={spanStyle}>{children}</span>
      </span>
    </div>
  );
}
