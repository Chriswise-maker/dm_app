interface AdjustButtonsProps {
  onAdjust: (delta: number) => void;
  increments?: number[];
}

export default function AdjustButtons({
  onAdjust,
  increments = [-5, -1, 1, 5],
}: AdjustButtonsProps) {
  return (
    <div className="flex items-center gap-2">
      {increments.map((delta) => (
        <button
          key={delta}
          onClick={() => onAdjust(delta)}
          className="font-sans text-[9px] text-ghost hover:text-vellum transition-colors"
        >
          {delta > 0 ? `+${delta}` : delta}
        </button>
      ))}
    </div>
  );
}
