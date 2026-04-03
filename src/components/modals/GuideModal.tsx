import { useEffect, useMemo, useState } from "react";
import { Button } from "../../ui/components/Button";
import guideIndex from "../../../docs/generated/guide-index.json";
import "./GuideModal.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

type GuideSection = {
  id: string;
  title: string;
  file: string;
};

const CHAPTER_ICONS: Record<string, string> = {
  overview: `<circle cx="12" cy="12" r="9"></circle><path d="M12 8v4m0 4v.01"></path>`,
  glossary: `<path d="M4 6h16M4 12h16M4 18h16"></path>`,
  dns: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8m3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"></path>`,
  firewall: `<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"></path><path d="M10 17h4v-5h-4z"></path>`,
  routes: `<circle cx="12" cy="12" r="1"></circle><circle cx="4" cy="12" r="1"></circle><circle cx="20" cy="12" r="1"></circle><path d="M7 12h10M4 12h2m8 0h2"></path>`,
  metrics: `<path d="M3 13h2v8H3zM7 5h2v16H7zm4-4h2v20h-2zm4 6h2v14h-2zm4-2h2v16h-2z"></path>`,
  limits: `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"></path>`,
};

const chapterModules = import.meta.glob<string>("../../../docs/guide/*.md", {
  query: "?raw",
  import: "default",
});

function splitInline(text: string): Array<{ type: "text" | "code" | "strong"; value: string }> {
  const chunks: Array<{ type: "text" | "code" | "strong"; value: string }> = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;

  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      chunks.push({ type: "text", value: text.slice(cursor, start) });
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      chunks.push({ type: "strong", value: token.slice(2, -2) });
    } else if (token.startsWith("`") && token.endsWith("`")) {
      chunks.push({ type: "code", value: token.slice(1, -1) });
    }

    cursor = start + token.length;
  }

  if (cursor < text.length) {
    chunks.push({ type: "text", value: text.slice(cursor) });
  }

  return chunks;
}

function renderInline(text: string, keyPrefix: string) {
  return splitInline(text).map((part, idx) => {
    const key = `${keyPrefix}-${idx}`;

    if (part.type === "strong") return <strong key={key}>{part.value}</strong>;
    if (part.type === "code") return <code key={key}>{part.value}</code>;
    return <span key={key}>{part.value}</span>;
  });
}

function renderMarkdown(markdown: string) {
  const lines = markdown.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      nodes.push(
        <pre key={`code-${i}`} className="guide-prose__code">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (line.startsWith("### ")) {
      nodes.push(
        <h3 key={`h3-${i}`} className="guide-prose__h3">
          {renderInline(line.slice(4), `h3-${i}`)}
        </h3>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={`h2-${i}`} className="guide-prose__h2">
          {renderInline(line.slice(3), `h2-${i}`)}
        </h2>,
      );
      i += 1;
      continue;
    }

    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={`h1-${i}`} className="guide-prose__h1">
          {renderInline(line.slice(2), `h1-${i}`)}
        </h1>,
      );
      i += 1;
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ""));
        i += 1;
      }
      nodes.push(
        <ol key={`ol-${i}`} className="guide-prose__list guide-prose__list--ordered">
          {items.map((item, idx) => (
            <li key={`oli-${i}-${idx}`}>{renderInline(item, `oli-${i}-${idx}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (/^-\s/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^-\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^-\s/, ""));
        i += 1;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="guide-prose__list">
          {items.map((item, idx) => (
            <li key={`uli-${i}-${idx}`}>{renderInline(item, `uli-${i}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    const paragraphLines = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() !== "") {
      const maybe = lines[i].trim();
      if (
        maybe.startsWith("#") ||
        /^\d+\.\s/.test(maybe) ||
        /^-\s/.test(maybe) ||
        maybe.startsWith("```")
      ) {
        break;
      }
      paragraphLines.push(maybe);
      i += 1;
    }

    const paragraph = paragraphLines.join(" ");
    nodes.push(
      <p key={`p-${i}`} className="guide-prose__p">
        {renderInline(paragraph, `p-${i}`)}
      </p>,
    );
  }

  return nodes;
}

export function GuideModal({ open, onClose }: Props) {
  const sections = useMemo<GuideSection[]>(
    () => guideIndex.sections.map((section) => ({ id: section.id, title: section.title, file: section.file })),
    [],
  );

  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? "overview");
  const [cache, setCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSection = sections.find((section) => section.id === activeId) ?? sections[0];

  useEffect(() => {
    if (!open) return;

    const loadActive = async () => {
      if (!activeSection || cache[activeSection.id]) return;

      setLoading(true);
      setError(null);

      try {
        const loader = chapterModules[`../../../${activeSection.file}`];
        if (!loader) {
          throw new Error(`Missing guide chapter: ${activeSection.file}`);
        }

        const markdown = await loader();
        setCache((prev) => ({ ...prev, [activeSection.id]: markdown }));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to load this guide chapter.";
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    void loadActive();
  }, [activeSection, cache, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="guide-modal__backdrop" onClick={onClose}>
      <div className="guide-modal__shell" onClick={(event) => event.stopPropagation()}>
        <div className="guide-modal__header">
          <div>
            <p className="guide-modal__eyebrow">Technical Guide</p>
            <h2 className="guide-modal__title">Learn Blip</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close guide">
            Close
          </Button>
        </div>

        <div className="guide-modal__body">
          <aside className="guide-modal__nav">
            <h3 className="guide-modal__nav-title">Learn</h3>
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`guide-modal__nav-item${section.id === activeSection?.id ? " guide-modal__nav-item--active" : ""}`}
                onClick={() => setActiveId(section.id)}
              >
                <svg
                  className="guide-modal__nav-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  dangerouslySetInnerHTML={{ __html: CHAPTER_ICONS[section.id] || "" }}
                />
                <span className="guide-modal__nav-label">{section.title}</span>
              </button>
            ))}
          </aside>

          <article className="guide-modal__content">
            {loading && <p className="guide-modal__state">Loading chapter...</p>}
            {!loading && error && <p className="guide-modal__state guide-modal__state--error">{error}</p>}
            {!loading && !error && activeSection && cache[activeSection.id] && (
              <div className="guide-prose">{renderMarkdown(cache[activeSection.id])}</div>
            )}
          </article>
        </div>
      </div>
    </div>
  );
}
