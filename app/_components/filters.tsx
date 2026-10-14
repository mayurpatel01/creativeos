export const GODS = ["GANESH", "SHIVA", "HANUMAN", "KRISHNA", "LAKSHMI", "DURGA", "OM"];
export const COUNTRIES = ["IND", "GUY", "TRI", "FIJ", "MAU", "CAN", "UK", "AUS", "SUR", "RSA"];
export const SIZES = ["FULL", "CHEST"];

export const ALL = "all";

export type FilterOption = { value: string; label: string };

export function toOptions(values: string[]): FilterOption[] {
  return values.map((value) => ({ value, label: value }));
}

export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-lg border bg-[#111] px-3 py-2 text-sm text-neutral-200 outline-none focus:border-[#c9a84c] focus:ring-1 focus:ring-[#c9a84c] ${
          value === ALL ? "border-neutral-700" : "border-[#c9a84c]/70"
        }`}
      >
        <option value={ALL}>{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ClearFiltersButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-300 transition hover:border-[#c9a84c] hover:text-[#c9a84c] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:text-neutral-300"
    >
      Clear filters
    </button>
  );
}

export function ResultCount({ shown, total }: { shown: number; total: number }) {
  return (
    <p className="ml-auto self-center text-sm text-neutral-500">
      <span className="font-semibold tabular-nums text-[#c9a84c]">{shown}</span> of{" "}
      <span className="tabular-nums">{total}</span> designs
    </p>
  );
}
