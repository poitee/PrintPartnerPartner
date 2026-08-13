import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  cancelPrinterSendQueueItem,
  dispatchPrinterSendQueueItem,
  drainPrinterSendQueue,
  fetchPrinterSendQueue,
  type PrinterSendQueueItem,
} from "../../api/engine";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  engineReady: boolean;
  refreshKey?: number;
  className?: string;
};

function stateLabel(item: PrinterSendQueueItem): string {
  switch (item.state) {
    case "queued":
      return item.wait_for_idle ? "Waiting for Idle" : "Queued";
    case "sending":
      return "Sending…";
    case "error":
      return "Error";
    case "done":
      return "Sent";
    case "cancelled":
      return "Cancelled";
    default:
      return item.state;
  }
}

/**
 * Thin Phase F queue list on Export — dispatch when Idle or force now.
 */
export default function PrinterSendQueuePanel({
  engineReady,
  refreshKey = 0,
  className,
}: Props) {
  const [items, setItems] = useState<PrinterSendQueueItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!engineReady) {
      setItems([]);
      return;
    }
    try {
      const { items: next } = await fetchPrinterSendQueue({ active: true });
      setItems(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    if (!engineReady) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [engineReady, reload]);

  if (!engineReady || items.length === 0) return null;

  return (
    <div
      className={cn(
        "rounded-md border border-border/80 bg-muted/20 px-2.5 py-2 text-xs",
        className,
      )}
      role="region"
      aria-label="Printer send queue"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium text-foreground">Send queue</p>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busyId != null}
          onClick={() => {
            setBusyId("drain");
            void (async () => {
              try {
                const { results } = await drainPrinterSendQueue();
                const ok = results.filter((r) => r.job_id).length;
                if (ok > 0) toast.success(`Started ${ok} queued send${ok === 1 ? "" : "s"}`);
                else toast.message("No idle printers ready for queued jobs");
                await reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : String(e));
              } finally {
                setBusyId(null);
              }
            })();
          }}
        >
          Send ready
        </Button>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5"
          >
            <span className="min-w-0 flex-1 leading-snug">
              <span className="font-medium">{item.filename}</span>
              <span className="text-muted-foreground">
                {" "}
                · {item.host_name || "printer"} · {stateLabel(item)}
                {item.start ? " · start" : ""}
              </span>
              {item.error ? (
                <span className="mt-0.5 block text-destructive">{item.error}</span>
              ) : null}
            </span>
            {(item.state === "queued" || item.state === "error") && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs"
                  disabled={busyId != null}
                  onClick={() => {
                    setBusyId(item.id);
                    void (async () => {
                      try {
                        await dispatchPrinterSendQueueItem({ id: item.id, force: true });
                        toast.success(`Sending ${item.filename}`);
                        await reload();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  Send now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={busyId != null}
                  onClick={() => {
                    setBusyId(item.id);
                    void (async () => {
                      try {
                        await cancelPrinterSendQueueItem(item.id);
                        await reload();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusyId(null);
                      }
                    })();
                  }}
                >
                  Remove
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
