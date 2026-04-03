import { ProcessRow } from "../../ui/components/ProcessRow";
import { CollapsibleSection } from "../../ui/components/CollapsibleSection";

interface Props {
  topProcesses: [string, { count: number }][];
}

export function TopProcesses({ topProcesses }: Props) {
  return (
    <CollapsibleSection title="Top Processes" count={topProcesses.length}>
      {topProcesses.map(([name, data]) => (
        <ProcessRow key={name} name={name} count={data.count} />
      ))}
      {topProcesses.length === 0 && (
        <span className="blip-text-empty">No processes detected yet</span>
      )}
    </CollapsibleSection>
  );
}
