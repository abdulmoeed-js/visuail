import { useEffect, useId, useRef, useState } from "react";
import { Bell, Slack, Mail, Check, AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Channel = "slack" | "email";

export function DriftNotifier({
  drifted, driftedNames, artifactTitle, demo = false, hasSources = true,
}: {
  drifted: boolean;
  driftedNames: string[];
  artifactTitle: string;
  /** Landing demo: drift is simulated, so the popover opens by itself and
   *  previews sending an alert. On a real project it only reports what the
   *  last re-check found -- alerts are set up in Team settings. */
  demo?: boolean;
  /** Real projects only: without a source there is nothing to re-check. */
  hasSources?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("slack");
  const [sent, setSent] = useState<null | { channel: Channel; at: number }>(null);
  const prev = useRef(false);
  const notifyLabelId = useId();

  // Auto-open once when drift first appears (demo only: on a real project
  // that would pop open on every visit to a project with drift)
  useEffect(() => {
    if (demo && drifted && !prev.current) {
      setOpen(true);
      setSent(null);
    }
    if (!drifted) setSent(null);
    prev.current = drifted;
  }, [demo, drifted]);

  const count = drifted ? Math.max(driftedNames.length, 1) : 0;
  const summary =
    count === 0
      ? demo ? "No drift detected." : hasSources ? "Nothing flagged at the last re-check." : "No sources to check yet."
      : demo
      ? `Drift detected in ${artifactTitle} — ${count} item${count === 1 ? "" : "s"} unresolved`
      : `${count} item${count === 1 ? "" : "s"} in ${artifactTitle} changed in your sources`;

  const send = () => setSent({ channel, at: Date.now() });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={demo
            ? `Notifications${count ? ` (${count} unread)` : ""}`
            : `Drift status: ${count ? `${count} item${count === 1 ? "" : "s"} changed` : "nothing flagged"}`}
          className={cn(
            "relative inline-flex h-8 w-8 items-center justify-center rounded-md border bg-card text-muted-foreground transition hover:bg-muted hover:text-foreground",
            drifted && "border-drift/40 text-drift animate-drift",
          )}
        >
          <Bell className="size-4" />
          {count > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-drift text-drift-foreground text-[10px] font-mono-tight leading-4 text-center"
              aria-hidden
            >
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0" sideOffset={8}>
        <div className="border-b p-3">
          <div className="flex items-start gap-2">
            <AlertOctagon className={cn("size-4 mt-0.5 shrink-0", drifted ? "text-drift" : "text-muted-foreground")} />
            <div className="min-w-0">
              <div className="eyebrow text-muted-foreground">
                Drift alert
              </div>
              <div className="text-sm font-semibold leading-snug">{summary}</div>
            </div>
          </div>
          {drifted && driftedNames.length > 0 && (
            <ul className="mt-2 space-y-1 pl-6 text-[12px] text-drift-ink list-disc marker:text-drift/60">
              {driftedNames.slice(0, 5).map((n) => (
                <li key={n} className="truncate">{n}</li>
              ))}
              {driftedNames.length > 5 && (
                <li className="list-none text-muted-foreground">
                  +{driftedNames.length - 5} more
                </li>
              )}
            </ul>
          )}
        </div>

        {!drifted ? (
          <div className="p-3 text-xs text-muted-foreground">
            {demo
              ? <>No drift detected yet. Click <em>Simulate source change</em> to preview an alert.</>
              : hasSources
              ? <>Use <em>Re-check for drift</em> to compare this project with its sources.</>
              : <>Add a source to check this project against it.</>}
          </div>
        ) : !demo ? null : sent ? (
          <div className="p-3">
            <div className="flex items-start gap-2 rounded-md border border-confident/40 bg-confident/10 p-2.5 text-confident-ink">
              <Check className="size-4 mt-0.5 shrink-0" />
              <div className="text-xs leading-snug">
                <div className="font-semibold">
                  {sent.channel === "slack"
                    ? "Sent to #product-eng via Slack"
                    : "Emailed alice@company.com"}
                </div>
                <div className="text-[11px] mt-0.5">
                  Preview only — nothing sent.
                </div>
              </div>
            </div>
            <Button
              size="sm" variant="ghost"
              className="mt-2 w-full h-8 text-xs"
              onClick={() => setSent(null)}
            >
              Send another
            </Button>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            <div>
              <div id={notifyLabelId} className="text-sm font-medium text-muted-foreground mb-1.5">
                Notify via
              </div>
              <div role="group" aria-labelledby={notifyLabelId} className="grid grid-cols-2 gap-1.5">
                <ChannelBtn
                  active={channel === "slack"} onClick={() => setChannel("slack")}
                  icon={<Slack className="size-3.5" />} label="Slack"
                  hint="#product-eng"
                />
                <ChannelBtn
                  active={channel === "email"} onClick={() => setChannel("email")}
                  icon={<Mail className="size-3.5" />} label="Email"
                  hint="alice@company.com"
                />
              </div>
            </div>
            <Button size="sm" className="w-full h-8" onClick={send}>
              Send notification
            </Button>
            <div className="text-[10px] font-mono-tight text-muted-foreground text-center">
              Preview only — nothing sent.
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ChannelBtn({
  active, onClick, icon, label, hint,
}: {
  active: boolean; onClick: () => void;
  icon: React.ReactNode; label: string; hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition",
        active
          ? "border-primary bg-primary/5"
          : "bg-card hover:bg-muted border-border",
      )}
    >
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {icon} {label}
      </span>
      <span className="text-[10px] font-mono-tight text-muted-foreground truncate max-w-full">
        {hint}
      </span>
    </button>
  );
}
