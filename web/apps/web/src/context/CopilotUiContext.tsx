import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { AssistantProposedAction } from "@print-partner/contracts";
import { isAssistantUiAction } from "@print-partner/contracts";
import { useProfileSelection } from "./ProfileContext";
import {
  buildRoute,
  buildsRoute,
  helpRoute,
  reviewRoute,
  settingsRoute,
  sourcesRoute,
} from "../lib/routes";

/** Real SourceDetailSheet tabs — map legacy `overview` to `docs`. */
export type CopilotSourceTab = "docs" | "rules" | "naming";

export function mapCopilotSourceTab(raw: string | undefined | null): CopilotSourceTab {
  if (raw === "rules" || raw === "naming") return raw;
  return "docs";
}

export type CopilotUiIntent =
  | {
      kind: "open_source";
      sourceName?: string;
      sourceId?: number;
      tab?: CopilotSourceTab;
      path?: string | null;
      query?: string;
    }
  | { kind: "focus_stl_search"; query?: string }
  | { kind: "open_build_sources"; profileId?: number }
  | { kind: "highlight_part"; planId: number; partId: number; surface: "review" | "checkoff" }
  | {
      kind: "focus_kit_option";
      planId?: number;
      groupId?: string;
      stlFilter?: string;
      sourceName?: string;
      sourceId?: number;
    };

type CopilotUiContextValue = {
  /** Monotonic counter — pages subscribe and read `lastIntent`. */
  intentSeq: number;
  lastIntent: CopilotUiIntent | null;
  executeUiAction: (action: AssistantProposedAction) => string | null;
  requestIntent: (intent: CopilotUiIntent) => void;
};

const CopilotUiContext = createContext<CopilotUiContextValue | null>(null);

function routePath(route: string, profileId: number | null | undefined): string {
  switch (route) {
    case "sources":
      return sourcesRoute();
    case "build":
      return buildRoute(profileId);
    case "review":
      return reviewRoute(profileId);
    case "checkoff":
      return reviewRoute(profileId);
    case "builds":
      return buildsRoute(profileId);
    case "settings":
      return settingsRoute();
    case "help":
      return helpRoute();
    default:
      return sourcesRoute();
  }
}

export function CopilotUiProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { setSelectedProfileId } = useProfileSelection();
  const [intentSeq, setIntentSeq] = useState(0);
  const lastIntentRef = useRef<CopilotUiIntent | null>(null);

  const requestIntent = useCallback((intent: CopilotUiIntent) => {
    lastIntentRef.current = intent;
    setIntentSeq((n) => n + 1);
  }, []);

  const executeUiAction = useCallback(
    (action: AssistantProposedAction): string | null => {
      if (!isAssistantUiAction(action.type)) return null;
      const params = action.params ?? {};
      const profileFromParams =
        typeof params.profile_id === "number" && params.profile_id > 0
          ? params.profile_id
          : typeof params.plan_id === "number" && params.plan_id > 0
            ? params.plan_id
            : action.plan_id > 0
              ? action.plan_id
              : null;

      if (profileFromParams != null) {
        setSelectedProfileId(profileFromParams);
      }

      let note: string | null;
      switch (action.type) {
        case "ui_navigate": {
          const route = String(params.route ?? "sources");
          navigate(routePath(route, profileFromParams));
          note = `Opened ${route}${profileFromParams ? ` for plan #${profileFromParams}` : ""}`;
          break;
        }
        case "ui_open_source":
        case "ui_open_docs": {
          const tab =
            action.type === "ui_open_docs"
              ? "docs"
              : mapCopilotSourceTab(
                  typeof params.tab === "string" ? params.tab : undefined,
                );
          const openSource = {
            sourceName: typeof params.source_name === "string" ? params.source_name : undefined,
            sourceId: typeof params.source_id === "number" ? params.source_id : undefined,
            tab,
            path: typeof params.path === "string" ? params.path : null,
            query: typeof params.query === "string" ? params.query : undefined,
          };
          navigate(sourcesRoute(), { state: { openSource } });
          requestIntent({ kind: "open_source", ...openSource });
          const name =
            typeof params.source_name === "string" ? params.source_name : "source";
          note = `Opened ${name} (${openSource.tab})`;
          break;
        }
        case "ui_focus_stl_search": {
          const query = typeof params.query === "string" ? params.query : undefined;
          navigate(sourcesRoute(), {
            state: { stlSearch: true, stlQuery: query },
          });
          requestIntent({ kind: "focus_stl_search", query });
          note = query
            ? `Opened Sources STL search for “${query}”`
            : "Opened Sources STL search";
          break;
        }
        case "ui_highlight_part": {
          const partId =
            typeof params.part_id === "number" ? params.part_id : Number(params.part_id);
          const planId = profileFromParams ?? action.plan_id;
          // Checkoff is folded into Review; keep accepting the legacy surface name.
          if (!Number.isFinite(partId) || planId <= 0) return null;
          navigate(reviewRoute(planId), { state: { previewPartId: partId } });
          requestIntent({
            kind: "highlight_part",
            planId,
            partId,
            surface: "review",
          });
          note = `Opened review preview for part #${partId}`;
          break;
        }
        case "ui_focus_kit_option": {
          const planId = profileFromParams ?? action.plan_id;
          const groupId =
            typeof params.group_id === "string" ? params.group_id.trim() : undefined;
          const stlFilter =
            typeof params.stl_filter === "string" ? params.stl_filter.trim() : undefined;
          const sourceName =
            typeof params.source_name === "string" ? params.source_name.trim() : undefined;
          const sourceId =
            typeof params.source_id === "number" && params.source_id > 0
              ? params.source_id
              : undefined;
          if (!groupId && !stlFilter) return null;
          const focusKit = {
            groupId: groupId || undefined,
            stlFilter: stlFilter || undefined,
            sourceName: sourceName || undefined,
            sourceId,
          };
          const path = buildRoute(planId > 0 ? planId : null);
          navigate(path, { state: { focusKit } });
          requestIntent({
            kind: "focus_kit_option",
            planId: planId > 0 ? planId : undefined,
            ...focusKit,
          });
          const bits = [
            groupId ? `option “${groupId}”` : null,
            stlFilter ? `STL “${stlFilter}”` : null,
          ].filter(Boolean);
          note = `Opened Build · ${bits.join(" · ")}`;
          break;
        }
        default:
          return null;
      }
      if (note && params.silent !== true) toast.success(note);
      return note;
    },
    [navigate, requestIntent, setSelectedProfileId],
  );

  const value = useMemo<CopilotUiContextValue>(
    () => ({
      intentSeq,
      lastIntent: lastIntentRef.current,
      executeUiAction,
      requestIntent,
    }),
    [executeUiAction, intentSeq, requestIntent],
  );

  return <CopilotUiContext.Provider value={value}>{children}</CopilotUiContext.Provider>;
}

export function useCopilotUi(): CopilotUiContextValue {
  const ctx = useContext(CopilotUiContext);
  if (!ctx) {
    throw new Error("useCopilotUi must be used within CopilotUiProvider");
  }
  return ctx;
}

/** Optional hook when the provider may be absent (tests). */
export function useCopilotUiOptional(): CopilotUiContextValue | null {
  return useContext(CopilotUiContext);
}
