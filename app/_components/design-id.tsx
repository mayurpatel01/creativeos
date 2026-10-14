// "GANESH_USA-IND_FULL_v1.png" -> "GANESH_USA-IND_FULL"
export function designLabel(suggestedFilename: string): string {
  return suggestedFilename.replace(/_v\d+\.png$/i, "");
}

export function DesignId({
  designNumber,
  suggestedFilename,
}: {
  designNumber: number | null;
  suggestedFilename: string;
}) {
  const label = designLabel(suggestedFilename);

  return (
    <div className="min-w-0">
      <div className="font-mono text-sm font-semibold tabular-nums text-[#c9a84c]">
        {designNumber === null ? "—" : `#${designNumber}`}
      </div>
      {label && (
        <div className="truncate font-mono text-[11px] text-neutral-500" title={label}>
          {label}
        </div>
      )}
    </div>
  );
}
