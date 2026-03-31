/**
 * CollapsibleSection -- FrostedCard + Collapsible with consistent glass styling.
 * Replaces the repeated pattern of FrostedCard(gap=0, className="blip-collapsible-card")
 * wrapping a Collapsible with a styled trigger span.
 */

import type { ReactNode } from "react";
import { FrostedCard } from "../glass";
import { Collapsible } from "@mattmattmattmatt/base/primitives/collapsible/Collapsible";
import "@mattmattmattmatt/base/primitives/collapsible/collapsible.css";
import "./CollapsibleSection.css";

interface CollapsibleSectionProps {
  /** Section title shown in the trigger */
  title: string;
  /** Optional count displayed after the title, e.g. "Services (12)" */
  count?: number;
  /** Whether the section starts expanded. Default: true */
  defaultOpen?: boolean;
  /** Trigger text color override (e.g. error color for blocked sections) */
  triggerColor?: string;
  /** Content gap between items. Default: 2 */
  gap?: number;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  triggerColor,
  gap = 2,
  children,
}: CollapsibleSectionProps) {
  const label = count !== undefined ? `${title} (${count})` : title;

  return (
    <FrostedCard gap={0} className="blip-collapsible-card">
      <Collapsible
        trigger={
          <span
            className="blip-collapsible-trigger"
            style={triggerColor ? { color: triggerColor } : undefined}
          >
            {label}
          </span>
        }
        defaultOpen={defaultOpen}
      >
        <div className="blip-collapsible-body" style={{ gap }}>
          {children}
        </div>
      </Collapsible>
    </FrostedCard>
  );
}
