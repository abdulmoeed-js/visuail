import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Small "click a badge, pick from a few options" control -- the same
// interaction RaciMatrixView's RaciCell already proved out, generalized so
// Risk Log/Change Request/Test Case/Stakeholder Analysis don't each
// reimplement it for their probability/impact/response/status/etc. fields.

export function SelectBadge<T extends string>({
  value, options, tone, onChange,
}: {
  value: T;
  options: readonly T[];
  tone: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-mono-tight font-medium hover:opacity-80 transition-opacity",
            tone(value),
          )}
        >
          {value}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-1" align="start">
        <div className="flex flex-col gap-0.5">
          {options.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className={cn(
                "rounded px-2 py-1 text-left text-xs hover:bg-muted transition-colors",
                o === value && "bg-muted font-medium",
              )}
            >
              {o}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
