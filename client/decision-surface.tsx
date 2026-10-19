import type { PluginTheme } from "@getpaseo/plugin";
import {
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
import { MIN_SPLIT_WIDTH } from "./resize-layout";

/** Shared by Home and all workspace views, independent of cards, filters and worker identities. */
export function DecisionSurface({
  theme,
  compact,
  params,
  children,
}: {
  theme: PluginTheme;
  compact: boolean;
  params: Readonly<Record<string, string>>;
  children: ReactNode;
}) {
  const query = useNeedsYou();
  const fleet = useFleet(5);
  const [destination, setDestination] = useState<DecisionDestination | null>(
    () => routeDecision(params),
  );
  const [width, setWidth] = useState(0);
  const focus = useRef<string | null>(null);
  const route = JSON.stringify(routeDecision(params));
  useEffect(() => {
    setDestination(JSON.parse(route) as DecisionDestination | null);
  }, [route]);
  const open = useCallback<OpenDecision>(
    (next = { requestId: "next" }, returnFocusId) => {
      focus.current = returnFocusId ?? null;
      setDestination(next);
    },
    [],
  );
  const close = useCallback(() => {
    setDestination(null);
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
    const next = decisionQueue(query.data.requests)[0];
    setDestination({
      homeId: query.data.homeId,
      requestId: next?.id ?? "empty",
      ...(next ? { recordRevision: next.revision } : {}),
    });
  }, [destination, query.data]);
  // Dock only when the remaining fleet pane can keep its wide header and opener.
  const full = compact || width < MIN_SPLIT_WIDTH + 440;
  const covered = destination !== null && full;
  return (
    <DecisionActionContext.Provider value={open}>
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
        {destination ? (
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
            <DecisionDrawer
              theme={theme}
              snapshot={query.data}
              offline={query.error !== null}
              destination={destination}
              onSelect={setDestination}
              onClose={close}
              mateId={fleet.data?.mate?.id ?? null}
              suggestions={fleet.data?.suggestions ?? []}
              compact={full}
            />
          </View>
        ) : null}
      </View>
    </DecisionActionContext.Provider>
  );
}
