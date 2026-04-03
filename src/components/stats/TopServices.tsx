import { useState } from "react";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import { chevronDown } from "@mattmattmattmatt/base/primitives/icon/icons/chevron-down";
import { chevronUp } from "@mattmattmattmatt/base/primitives/icon/icons/chevron-up";
import { ServiceRow } from "../../ui/components/ServiceRow";
import { CollapsibleSection } from "../../ui/components/CollapsibleSection";
import { Button } from "../../ui/components/Button";
import { getBrandIcon } from "../../utils/brand-icons";
import type { EndpointType } from "../../utils/endpoint-type";

import serverIcon from "../../assets/icons/server.png";
import chatIcon from "../../assets/icons/chat.png";
import streamingIcon from "../../assets/icons/streaming.png";
import shieldIcon from "../../assets/icons/shield.png";

const ICON_MAP: Record<EndpointType, string> = {
  server: serverIcon,
  chat: chatIcon,
  streaming: streamingIcon,
  shield: shieldIcon,
};

const PAGE_SIZE = 5;

interface ServiceStat {
  type: EndpointType;
  label: string;
  count: number;
  domains: string[];
  bytesSent: number;
  bytesReceived: number;
  lastSeenMs: number;
}

interface Props {
  services: ServiceStat[];
  activeServiceFilter?: string | null;
  onServiceClick?: (serviceName: string | null) => void;
}

export function TopServices({ services, activeServiceFilter = null, onServiceClick }: Props) {
  const [showAllServices, setShowAllServices] = useState(false);

  const visibleServices = showAllServices ? services : services.slice(0, PAGE_SIZE);

  return (
    <CollapsibleSection title="Services" count={services.length}>
      {visibleServices.map((svc, i) => {
        const iconUrl = (() => {
          const byLabel = getBrandIcon(null, svc.label);
          if (byLabel) return byLabel.url;
          for (const d of svc.domains) {
            const brand = getBrandIcon(d, svc.label);
            if (brand) return brand.url;
          }
          return ICON_MAP[svc.type];
        })();
        const isActive = activeServiceFilter === svc.label;
        return (
          <ServiceRow
            key={`${svc.label}-${i}`}
            name={svc.label}
            domain={svc.domains.length > 0 ? svc.domains.slice(0, 3).join(", ") : undefined}
            iconUrl={iconUrl}
            bytesSent={svc.bytesSent}
            bytesReceived={svc.bytesReceived}
            style={{ cursor: "pointer", opacity: activeServiceFilter && !isActive ? 0.4 : 1, transition: "opacity 0.2s" }}
            onClick={() => onServiceClick?.(isActive ? null : svc.label)}
          />
        );
      })}
      {services.length > PAGE_SIZE && (
        <Button
          variant="ghost"
          size="sm"
          icon={showAllServices ? chevronUp : chevronDown}
          onClick={() => setShowAllServices(!showAllServices)}
        >
          {showAllServices ? "Show less" : `Show all (${services.length})`}
        </Button>
      )}
      {services.length === 0 && (
        <span className="blip-text-empty">No services detected yet</span>
      )}
    </CollapsibleSection>
  );
}
