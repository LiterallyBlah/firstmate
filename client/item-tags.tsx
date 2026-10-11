/** Shared plain-tag editor and filter controls for List and Board. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { FleetCard } from "../shared/fleet";
import {
  cardTags,
  editItemTag,
  ItemTagSchema,
  itemTagKey,
  MAX_ITEM_TAGS,
  MAX_TAG_LENGTH,
  tagChoices,
  tagIdentity,
} from "../shared/item-tags";
import { errorText, IconButton } from "./ui";
import { bindWebKeys, hasWebFocus, webTitle } from "./web";

export function ItemTagEditor({
  card,
  theme,
  onChanged,
}: {
  card: FleetCard;
  theme: PluginTheme;
  onChanged: () => void;
}) {
  const edit = useRpc(editItemTag);
  const toast = useToast();
  const gate = useRef(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [tags, setTags] = useState(cardTags(card));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTags(cardTags(card)), [card.tags, card.backlog?.tags]);

  async function change(tag: string, present: boolean): Promise<void> {
    if (gate.current) return;
    const parsed = ItemTagSchema.safeParse(tag);
    if (!parsed.success) {
      setError(
        `Use 1–${MAX_TAG_LENGTH} characters, without commas or parentheses.`,
      );
      return;
    }
    gate.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await edit({
        key: itemTagKey(card),
        tag: parsed.data,
        present,
      });
      setTags(result.tags);
      if (present) setDraft("");
      onChanged();
    } catch (failure) {
      const message = errorText(failure);
      setError(message);
      toast.error(message);
    } finally {
      gate.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Tags · {tags.length}/{MAX_ITEM_TAGS}
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {tags.map((tag) => (
          <Pressable
            key={tagIdentity(tag)}
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${tag}`}
            accessibilityHint={`Remove ${tag} from this item.`}
            accessibilityState={{ disabled: busy }}
            {...webTitle(tag)}
            disabled={busy}
            onPress={() => void change(tag, false)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              maxWidth: "100%",
              padding: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface1,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                minWidth: 0,
                color: theme.colors.foreground,
                fontSize: 12,
              }}
            >
              {tag}
            </Text>
            <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <TextInput
          accessibilityLabel={`New tag for ${card.title}`}
          placeholder="Add a tag…"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => void change(draft, true)}
          maxLength={MAX_TAG_LENGTH}
          editable={!busy && tags.length < MAX_ITEM_TAGS}
          style={{
            flex: 1,
            minWidth: 0,
            color: theme.colors.foreground,
            backgroundColor: theme.colors.surface1,
            borderColor: theme.colors.border,
            borderWidth: 1,
            borderRadius: 8,
            padding: 8,
            fontSize: 12,
          }}
        />
        <IconButton
          icon="Plus"
          label="Add tag"
          theme={theme}
          showLabel
          disabled={busy || tags.length >= MAX_ITEM_TAGS || draft.trim() === ""}
          onPress={() => void change(draft, true)}
        />
      </View>
      {tags.length < MAX_ITEM_TAGS ? null : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Remove a tag to add another.
        </Text>
      )}
      {error === null ? null : (
        <Text
          role="alert"
          style={{ color: theme.colors.statusDanger, fontSize: 12 }}
        >
          {error}
        </Text>
      )}
    </View>
  );
}

export function ItemTagFilter({
  cards,
  selected,
  theme,
  onChange,
}: {
  cards: readonly FleetCard[];
  selected: readonly string[];
  theme: PluginTheme;
  onChange: (tags: string[]) => void;
}) {
  const choices = tagChoices(cards, selected);
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(32);
  const [bottoms, setBottoms] = useState<Record<string, number>>({});
  const controlsId = useId();
  const toggle = useRef<View>(null);
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const chips = useRef(new Map<string, View>());
  const collapsedHeight = rowHeight * 2 + 6;
  const overflowing = contentHeight > collapsedHeight + 1;
  const choiceLayout = JSON.stringify(
    choices.map(({ tag, count }) => [tag, count, selected.includes(tag)]),
  );
  function toggleTag(tag: string): void {
    const checked = selected.some(
      (value) => tagIdentity(value) === tagIdentity(tag),
    );
    onChange(
      checked
        ? selected.filter((value) => tagIdentity(value) !== tagIdentity(tag))
        : [...selected, tag],
    );
  }
  function measureChips(): void {
    const parent = content.current;
    if (parent === null) return;
    // RN Web's onLayout observes size, not position: wrapping can move a chip
    // without resizing it. Measure every chip when the container or labels change.
    for (const [key, node] of chips.current) {
      node.measureLayout(parent, (_x, y, _width, height) => {
        if (key === tagIdentity(choices[0]?.tag ?? "")) setRowHeight(height);
        const bottom = y + height;
        setBottoms((current) =>
          current[key] === bottom ? current : { ...current, [key]: bottom },
        );
      });
    }
  }
  useLayoutEffect(measureChips, [choiceLayout]);
  useLayoutEffect(() => {
    // RN Web activates these checkbox Pressables with Enter but not Space.
    const cleanups = choices.map(({ tag }) =>
      bindWebKeys(
        chips.current.get(tagIdentity(tag)),
        (key, _shift, repeat) => {
          if (
            key !== " " ||
            (!expanded &&
              (bottoms[tagIdentity(tag)] ?? 0) > collapsedHeight + 1)
          )
            return false;
          if (
            selected.length >= MAX_ITEM_TAGS &&
            !selected.some((value) => tagIdentity(value) === tagIdentity(tag))
          )
            return false;
          if (!repeat) toggleTag(tag);
          return true;
        },
      ),
    );
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [choiceLayout, expanded, bottoms, collapsedHeight, onChange]);
  useLayoutEffect(() => {
    if (expanded) return;
    // A resize can move the focused chip into a clipped row. Keep keyboard
    // focus on the disclosure instead of leaving it on an invisible filter.
    for (const [key, node] of chips.current) {
      if ((bottoms[key] ?? 0) > collapsedHeight + 1 && hasWebFocus(node)) {
        toggle.current?.focus();
        break;
      }
    }
  }, [expanded, bottoms, collapsedHeight]);
  if (choices.length === 0) return null;
  return (
    <View
      testID="firstmate-tag-filter"
      style={{
        flexShrink: 0,
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 6,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Filter tags · {selected.length} selected · match all
        </Text>
        {selected.length === 0 ? null : (
          <IconButton
            icon="X"
            label="Clear tag filters"
            theme={theme}
            showLabel
            onPress={() => onChange([])}
          />
        )}
        {!overflowing ? null : (
          <Pressable
            ref={toggle}
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? "Show less tag filters" : "Show more tag filters"
            }
            accessibilityState={{ expanded }}
            aria-expanded={expanded}
            aria-controls={controlsId}
            onPress={() => {
              scroll.current?.scrollTo({ y: 0, animated: false });
              setExpanded(!expanded);
            }}
            style={{ paddingHorizontal: 8, paddingVertical: 4 }}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
              {expanded ? "Show less" : "Show more"}
            </Text>
          </Pressable>
        )}
      </View>
      <ScrollView
        ref={scroll}
        nativeID={controlsId}
        testID="firstmate-tag-filter-choices"
        scrollEnabled={expanded}
        style={{
          maxHeight: expanded
            ? Math.max(214, collapsedHeight)
            : collapsedHeight,
          flexGrow: 0,
        }}
      >
        <View
          ref={content}
          onLayout={({ nativeEvent: { layout } }) => {
            setContentHeight(layout.height);
            measureChips();
          }}
          style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
        >
          {choices.map(({ tag, count }) => {
            const checked = selected.some(
              (value) => tagIdentity(value) === tagIdentity(tag),
            );
            const key = tagIdentity(tag);
            const hidden =
              !expanded && (bottoms[key] ?? 0) > collapsedHeight + 1;
            return (
              <Pressable
                key={key}
                ref={(node) => {
                  if (node === null) chips.current.delete(key);
                  else chips.current.set(key, node);
                }}
                accessibilityRole="checkbox"
                accessibilityElementsHidden={hidden}
                importantForAccessibility={
                  hidden ? "no-hide-descendants" : "auto"
                }
                aria-hidden={hidden}
                tabIndex={
                  hidden || (!checked && selected.length >= MAX_ITEM_TAGS)
                    ? -1
                    : 0
                }
                accessibilityLabel={`Filter tag ${tag}, ${count} items`}
                accessibilityState={{
                  checked,
                  disabled: !checked && selected.length >= MAX_ITEM_TAGS,
                }}
                aria-checked={checked}
                aria-disabled={!checked && selected.length >= MAX_ITEM_TAGS}
                disabled={!checked && selected.length >= MAX_ITEM_TAGS}
                onPress={() => toggleTag(tag)}
                style={{
                  maxWidth: "100%",
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: checked
                    ? theme.colors.accent
                    : theme.colors.border,
                  backgroundColor: checked
                    ? theme.colors.accent
                    : theme.colors.surface1,
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{
                    color: checked
                      ? theme.colors.accentForeground
                      : theme.colors.foreground,
                    fontSize: 12,
                    lineHeight: 16,
                  }}
                >
                  {checked ? "✓ " : ""}
                  {tag} · {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
