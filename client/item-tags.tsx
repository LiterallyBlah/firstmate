/** Shared plain-tag editor and filter controls for List and Board. */
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import {
  Icon,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
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
import { webTitle } from "./web";

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
  if (choices.length === 0) return null;
  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        gap: 6,
        borderBottomWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Filter tags · match all selected
      </Text>
      <ScrollView
        style={{ maxHeight: 108 }}
        contentContainerStyle={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        {choices.map(({ tag, count }) => {
          const checked = selected.some(
            (value) => tagIdentity(value) === tagIdentity(tag),
          );
          return (
            <Pressable
              key={tagIdentity(tag)}
              accessibilityRole="checkbox"
              accessibilityLabel={`Filter tag ${tag}, ${count} items`}
              accessibilityState={{
                checked,
                disabled: !checked && selected.length >= MAX_ITEM_TAGS,
              }}
              aria-checked={checked}
              aria-disabled={!checked && selected.length >= MAX_ITEM_TAGS}
              disabled={!checked && selected.length >= MAX_ITEM_TAGS}
              onPress={() =>
                onChange(
                  checked
                    ? selected.filter(
                        (value) => tagIdentity(value) !== tagIdentity(tag),
                      )
                    : [...selected, tag],
                )
              }
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
                }}
              >
                {checked ? "✓ " : ""}
                {tag} · {count}
              </Text>
            </Pressable>
          );
        })}
        {selected.length === 0 ? null : (
          <IconButton
            icon="X"
            label="Clear tag filters"
            theme={theme}
            showLabel
            onPress={() => onChange([])}
          />
        )}
      </ScrollView>
    </View>
  );
}
