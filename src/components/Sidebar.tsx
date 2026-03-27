import { useState, useCallback, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import { ScrollArea } from "@mattmattmattmatt/base/primitives/scroll-area/ScrollArea";
import "@mattmattmattmatt/base/primitives/scroll-area/scroll-area.css";
import "./Sidebar.css";

const MIN_WIDTH = 280;
const MAX_WIDTH = 500;
const DEFAULT_WIDTH = 340;

interface SidebarProps {
  children: ReactNode;
  onWidthChange?: (width: number) => void;
}

export function Sidebar({ children, onWidthChange }: SidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta));
      setWidth(newWidth);
      onWidthChange?.(newWidth);
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar__resize-handle" onMouseDown={onMouseDown} />
      <ScrollArea maxHeight="100%" direction="vertical" style={{ flex: 1, width: "100%" }}>
        <div className="sidebar__content">
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}
