import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import type { ReactNode } from "react";
import { parseDecisionBrief } from "../shared/decision-brief";
import type { NeedsYouRequest, NeedsYouSnapshot } from "../shared/needs-you";
import { Markdown } from "./markdown";
import { errorText } from "./format";
import { planDecisionFor } from "../shared/plan-decisions";

function BriefMarkdown({
  source,
  theme,
  fontSize = 13,
}: {
  source: string;
  theme: PluginTheme;
  fontSize?: number;
}) {
  const toast = useToast();
  return (
    <Markdown
      source={source}
      theme={theme}
      fontSize={fontSize}
      onOpenLink={(url) => {
        if (/^https?:\/\//i.test(url))
          void openExternalUrl(url).catch((error) =>
            toast.error(errorText(error)),
          );
      }}
    />
  );
}

export function briefFor(
  snapshot: NeedsYouSnapshot | undefined,
  request: NeedsYouRequest,
) {
  return snapshot?.briefs?.find(
    (brief) =>
      brief.requestId === request.id &&
      brief.recordRevision === request.revision,
  );
}

/** Render every authored section, retaining unfamiliar prose and headings as ordinary Markdown. */
export function DecisionBrief({
  theme,
  content,
  answer,
}: {
  theme: PluginTheme;
  content: string;
  answer(label: string): ReactNode;
}) {
  const brief = parseDecisionBrief(content),
    colors = theme.colors;
  return (
    <View style={{ gap: 16 }} testID="decision-brief">
      {brief.sections.map((section, i) => {
        const options =
          section.kind === "options"
            ? brief.options.filter((option) =>
                section.body.includes(option.body),
              )
            : [];
        return (
          <View
            key={i}
            style={{
              gap: 8,
              ...(section.kind === "recommendation"
                ? {
                    borderLeftWidth: 3,
                    borderLeftColor: colors.accent,
                    padding: 12,
                    borderRadius: 8,
                    backgroundColor: colors.surface2,
                  }
                : {}),
            }}
          >
            {section.title ? (
              <Text
                accessibilityRole="header"
                style={{
                  color: colors.foreground,
                  fontWeight: "700",
                  fontSize: 14,
                }}
              >
                {section.title}
              </Text>
            ) : null}
            {options.length ? (
              <>
                <BriefMarkdown
                  source={section.body.slice(
                    0,
                    section.body.indexOf(options[0]!.body),
                  )}
                  theme={theme}
                />
                {options.map((option) => (
                  <View
                    key={option.number}
                    style={{
                      gap: 8,
                      padding: 12,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 8,
                    }}
                  >
                    <BriefMarkdown source={option.body} theme={theme} />
                    {answer(option.label)}
                  </View>
                ))}
              </>
            ) : (
              <BriefMarkdown source={section.body} theme={theme} />
            )}
          </View>
        );
      })}
    </View>
  );
}

export function DecisionSummary({
  theme,
  snapshot,
  request,
  showQuestion = true,
}: {
  theme: PluginTheme;
  snapshot?: NeedsYouSnapshot | undefined;
  request: NeedsYouRequest;
  showQuestion?: boolean;
}) {
  const brief = briefFor(snapshot, request);
  const recommendation = (brief ? parseDecisionBrief(brief.content).recommendation : "") || planDecisionFor(snapshot, request.id)?.recommendation || "";
  return (
    <View style={{ gap: 6 }}>
      {showQuestion ? <Text
        style={{ color: theme.colors.foreground, fontSize: 12, lineHeight: 18 }}
      >
        {request.source.ask}
      </Text> : null}
      {recommendation ? (
        <View
          style={{
            borderLeftWidth: 2,
            borderLeftColor: theme.colors.accent,
            paddingLeft: 8,
            gap: 3,
          }}
        >
          <Text
            style={{
              color: theme.colors.foreground,
              fontWeight: "600",
              fontSize: 12,
            }}
          >
            Recommendation
          </Text>
          <BriefMarkdown source={recommendation} theme={theme} fontSize={12} />
        </View>
      ) : null}
    </View>
  );
}
