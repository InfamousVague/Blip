import type { CSSProperties, ReactNode } from "react";

interface DetailRowProps {
  label: string;
  value: ReactNode;
  mono?: boolean;
  color?: string;
  style?: CSSProperties;
}

/**
 * A reusable label: value row used in detail panels and settings.
 * Renders a left-aligned label and right-aligned value.
 */
export function DetailRow({ label, value, mono = false, color, style }: DetailRowProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "var(--sp-2)",
        ...style,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: "var(--font-sans)",
          color: "var(--blip-text-tertiary)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 11,
          fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
          color: color || "var(--blip-text-primary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </div>
  );
}
