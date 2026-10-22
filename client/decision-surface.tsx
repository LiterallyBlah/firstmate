import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { displaySettings } from "../shared/settings";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { View } from "react-native";
import { DecisionActionContext, type OpenDecision } from "./decision-action";
import { DecisionDrawer } from "./decision-drawer";
import { useNeedsYou } from "./needs-you-query";
import {
  decisionQueue,
  routeDecision,
  type DecisionDestination,
} from "./needs-you-state";
import { focusWebElement, webAttributes } from "./web";
import { useFleet } from "./fleet-query";
import type { FleetShell, FleetView } from "./shell";
import { MIN_SPLIT_WIDTH } from "./resize-layout";
import { decisionCardSnapshot } from "../shared/plan-decisions";
import { discussionRequest, prepareDiscussion, routeDiscussion, type DecisionDiscussion } from "./decision-discussion";

const DecisionHandoffContext = createContext<{
  discussion: DecisionDiscussion | null;
  boardRequest: object | null;
  resume(): boolean;
  dismiss(): void;
}>({ discussion: null, boardRequest: null, resume: () => false, dismiss() {} });
export function useDecisionHandoff() { return useContext(DecisionHandoffContext); }

const DecisionPaneContext = createContext<{
  drawer: ReactNode;
  open: boolean;
  register(value: boolean): void;
  origin(label: string): void;
}>({ drawer: null, open: false, register() {}, origin() {} });
export function useDecisionOrigin(label: string) {
  const { origin } = useContext(DecisionPaneContext);
  useEffect(() => origin(label), [label, origin]);
}
export function useDecisionPaneOpen() {
  return useContext(DecisionPaneContext).open;
}

/** The task pane owns its covering layer, so Home's chat and header keep their exact size. */
export function DecisionPane({ children }: { children: ReactNode }) {
  const { drawer, register } = useContext(DecisionPaneContext);
  useEffect(() => {
    register(true);
    return () => register(false);
  }, [register]);
  const covered = drawer !== null;
  return (
    <View style={{ flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
      <View
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
        aria-hidden={covered}
        {...webAttributes({ inert: covered ? "" : null })}
        pointerEvents={covered ? "none" : "auto"}
        style={{ flex: 1, minHeight: 0, minWidth: 0 }}
      >
        {children}
      </View>
      {drawer ? (
        <View style={{ position: "absolute", inset: 0, zIndex: 20 }}>
          {drawer}
        </View>
      ) : null}
    </View>
  );
}

/** Shared by Home and all workspace views, independent of cards, filters and worker identities. */
export function DecisionSurface({
  theme,
  compact,
  params,
  children,
  shell,
  view = "home",
}: {
  shell?: FleetShell | undefined;
  view?: FleetView | "home" | undefined;
  theme: PluginTheme;
  compact: boolean;
  params: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  const query = useNeedsYou(),
    fleet = useFleet(5);
  const display = useSettings(displaySettings);
  const filtered =
    display.status === "ready" &&
    (display.values.hostTab !== "all" || display.values.tagFilter.length > 0);
  const mateId = fleet.data?.mate?.id ?? null;
  const [destination, setDestination] = useState<DecisionDestination | null>(
    () => params.decisionBoard === "show" ? null : routeDecision(params),
  );
  const [discussion, setDiscussion] = useState(() => routeDiscussion(params));
  const prepared = useRef<DecisionDiscussion | null>(null);
  useEffect(() => {
    if (!discussion || !mateId || prepared.current === discussion) return;
    if (prepareDiscussion(discussion, query.data, mateId, query.error !== null)) prepared.current = discussion;
  }, [discussion, query.data, mateId, query.error]);
  const [boardRequest, setBoardRequest] = useState<object | null>(() => params.decisionBoard === "show" ? {} : null);
  const [width, setWidth] = useState(0),
    [hasPane, setHasPane] = useState(false);
  const focus = useRef<string | null>(null);
  const origin = useRef("Home");
  const [returnLabel, setReturnLabel] = useState("Home");
  const registerOrigin = useCallback((label: string) => { origin.current = label; }, []);
  const route = JSON.stringify([routeDecision(params), routeDiscussion(params), params.decisionBoard, params.decisionHandoff]);
  const previousRoute = useRef(route);
  useEffect(() => {
    if (previousRoute.current === route) return;
    previousRoute.current = route;
    const [next, chat, board] = JSON.parse(route) as [DecisionDestination | null, DecisionDiscussion | null, string | null];
    setDestination(board === "show" ? null : next);
    setDiscussion(chat);
    setBoardRequest(board === "show" ? {} : null);
  }, [route]);
  const open = useCallback<OpenDecision>(
    (next = { requestId: "next" }, returnFocusId) => {
      focus.current = returnFocusId ?? null;
      setReturnLabel(origin.current);
      setDiscussion(null);
      setDestination(next);
    },
    [],
  );
  const close = useCallback(() => {
    setDestination(null);
    setDiscussion(null);
    if (focus.current) focusWebElement(focus.current);
  }, []);
  useEffect(() => {
    if (
      destination?.requestId !== "next" ||
      !query.data?.homeId ||
      query.data.actionCount === null
    )
      return;
    if (destination.homeId && destination.homeId !== query.data.homeId) return;
    const next = decisionQueue(decisionCardSnapshot(query.data).requests).find(
      (r) => r.state === "new" || r.state === "seen",
    );
    setDestination({
      homeId: query.data.homeId,
      requestId: next?.id ?? "empty",
      ...(next ? { recordRevision: next.revision } : {}),
    });
  }, [destination, query.data]);
  const phone = compact || width < MIN_SPLIT_WIDTH;
  const paneCover = !phone && width < 1600 && hasPane;
  const full = phone || (!hasPane && width < (view === "chat" ? 1100 : 1600));
  // A covered chat must become usable while discussing; the selected reference stays here.
  const suspended = discussion !== null && full;
  const covered = destination !== null && full && !suspended;
  const drawer =
    destination && width > 0 && !suspended ? (
      <DecisionDrawer
        onOpenBoard={
          view === "home" || shell
            ? () => {
                const target = destination;
                close();
                if (view === "home") setBoardRequest({});
                else shell?.openDecision(target, { board: true });
              }
            : undefined
        }
        onOpenChat={
          mateId && (view === "home" || view === "chat" || shell)
            ? (target) => {
                if (!target.homeId || !target.recordRevision) return;
                const reference = { ...target, homeId: target.homeId, recordRevision: target.recordRevision, mateId };
                // Even a stale/uncertain answer can open its chat for inspection.
                // Preparing a draft and returning to the decision each recheck the reference.
                if (view === "home" || view === "chat") {
                  setDestination(target);
                  setDiscussion(reference);
                } else shell?.openDecision(target, { discussWith: mateId });
              }
            : undefined
        }
        theme={theme}
        snapshot={query.data}
        offline={query.error !== null}
        loading={query.isLoading}
        filtered={filtered}
        destination={destination}
        onSelect={(next) => { setDiscussion(null); setDestination(next); }}
        onClose={close}
        mateId={mateId}
        suggestions={fleet.data?.suggestions ?? []}
        compact={phone}
        modal={full}
        returnLabel={returnLabel}
      />
    ) : null;
  return (
    <DecisionActionContext.Provider value={open}>
      <DecisionHandoffContext.Provider value={{ discussion, boardRequest,
        dismiss: () => { setDiscussion(null); if (suspended) setDestination(null); },
        resume: () => {
          if (!discussionRequest(discussion, query.data, mateId, query.error !== null)) return false;
          const { mateId: _mate, ...target } = discussion!;
          setDestination(target);
          setDiscussion(null);
          return true;
        },
      }}>
      <DecisionPaneContext.Provider
        value={{
          drawer: paneCover ? drawer : null,
          open: destination !== null,
          register: setHasPane,
          origin: registerOrigin,
        }}
      >
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={{
            flex: 1,
            minHeight: 0,
            flexDirection: "row",
            position: "relative",
          }}
        >
          <View
            accessibilityElementsHidden={covered}
            importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
            aria-hidden={covered}
            {...webAttributes({ inert: covered ? "" : null })}
            pointerEvents={covered ? "none" : "auto"}
            style={{ flex: 1, minWidth: 0 }}
          >
            {children}
          </View>
          {drawer && !paneCover ? (
            <View
              style={
                full
                  ? {
                      position: "absolute",
                      inset: 0,
                      zIndex: 20,
                      backgroundColor: theme.colors.surface0,
                    }
                  : { width: 440, flexShrink: 0 }
              }
            >
              {drawer}
            </View>
          ) : null}
        </View>
      </DecisionPaneContext.Provider>
      </DecisionHandoffContext.Provider>
    </DecisionActionContext.Provider>
  );
}
