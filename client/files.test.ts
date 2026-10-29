import { act, createElement, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { attentionTheme } from "../test/attention-deck-fixture";
import type { Banner, IconButton } from "./ui";

const rpc = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), copy: vi.fn(async () => {}), list: vi.fn(async () => ({ entries: [] })) }));
vi.mock("react-native", () => ({ Platform: { OS: "web" }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", View: "View" }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => contract.name.endsWith(".read") ? rpc.read : contract.name.endsWith(".write") ? rpc.write : rpc.list,
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null, TextInput: "TextInput", copyText: rpc.copy, useToast: () => ({ show() {}, error() {} }) }));
vi.mock("./keyboard", () => ({ useKeyboardOverlap: () => 0 }));
vi.mock("./markdown", () => ({ Markdown: () => null }));
vi.mock("./ui", () => ({ MONOSPACE: "monospace", errorText: (error: Error) => error.message,
  Banner: (props: object) => createElement("Banner", props), IconButton: (props: object) => createElement("IconButton", props),
}));
import { FilesView } from "./files";
import { fileLosses } from "../shared/file-losses";

it.each([false, true])("recovers a failed read, preserves both conflict versions and guards unsaved navigation, compact=%s", async compact => {
  rpc.read.mockReset(); rpc.write.mockReset(); rpc.copy.mockClear();
  const path = `sample-${compact}.md`;
  const result = (content: string, modifiedMs: number) => ({ path, content, modifiedMs, hash: String(modifiedMs).padStart(64, "0"), binary: false, size: content.length, tooLarge: false });
  rpc.read.mockRejectedValueOnce(new Error("Read failed"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree: ReactTestRenderer;
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(FilesView, {
    theme: attentionTheme, compact, request: { path, at: compact ? 2 : 1 },
  }))); });
  const banners = () => tree!.root.findAllByType("Banner" as never).map(n => n.props as ComponentProps<typeof Banner>);
  const action = (label: string) => banners().flatMap(b => [...(b.action ? [b.action] : []), ...(b.actions ?? [])]).find(a => a.label === label)!;
  const button = (label: string) => tree!.root.findAllByType("IconButton" as never).map(n => n.props as ComponentProps<typeof IconButton>).find(b => b.label === label)!;
  const editor = () => tree!.root.findByProps({ accessibilityLabel: `Edit ${path}` });
  expect(action("Retry")).toBeDefined();
  let finishRead!: (value: ReturnType<typeof result>) => void;
  rpc.read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  await act(async () => { const retry = action("Retry"); retry.onPress(); retry.onPress(); });
  expect(rpc.read).toHaveBeenCalledTimes(2); // first failure and one retry
  await act(async () => finishRead(result("Original", 10)));
  await act(async () => editor().props.onChangeText("My unsaved text"));
  rpc.write.mockRejectedValueOnce(new Error("File changed since you opened it"));
  await act(async () => button("Save").onPress());
  expect(rpc.write).toHaveBeenLastCalledWith({ path, content: "My unsaved text", expectedHash: String(10).padStart(64, "0"), force: false, reviewedLosses: [] });
  expect(action("Overwrite")).toBeUndefined();
  expect(action("Compare copies")).toBeDefined();
  await act(async () => action("Copy my text").onPress());
  expect(rpc.copy).toHaveBeenLastCalledWith("My unsaved text");
  expect(editor().props.value).toBe("My unsaved text");
  rpc.read.mockResolvedValueOnce(result("Their new text", 20));
  await act(async () => action("Compare copies").onPress());
  expect(JSON.stringify(tree!.toJSON())).toContain("Original");
  expect(JSON.stringify(tree!.toJSON())).toContain("Their new text");
  expect(JSON.stringify(tree!.toJSON())).toContain("My unsaved text");
  await act(async () => button("Keep editing my draft").onPress());
  expect(editor().props.value).toBe("My unsaved text");
  await act(async () => editor().props.onChangeText("My second draft"));
  rpc.write.mockRejectedValueOnce(new Error("File changed since you opened it"));
  await act(async () => button("Save").onPress());
  rpc.read.mockResolvedValueOnce(result("Their latest text", 25));
  await act(async () => action("Compare copies").onPress());
  let finishWrite!: (value: { path: string; modifiedMs: number; hash: string }) => void;
  rpc.write.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
  await act(async () => { const overwrite = button("Replace with my text"); overwrite.onPress(); overwrite.onPress(); });
  expect(rpc.write).toHaveBeenCalledTimes(3); // two checked conflicts and one deliberate overwrite
  expect(rpc.write).toHaveBeenLastCalledWith({ path, content: "My second draft", expectedHash: String(25).padStart(64, "0"), force: true, reviewedLosses: [] });
  await act(async () => button("Keep editing my draft").onPress());
  await act(async () => { editor().props.onChangeText("Typed during save"); finishWrite({ path, modifiedMs: 30, hash: String(30).padStart(64, "0") }); });
  expect(editor().props.value).toBe("Typed during save");
  expect(JSON.stringify(tree!.toJSON())).toContain("Unsaved changes");
  if (compact) {
    await act(async () => button("Back to the files").onPress());
    expect(button("Keep editing")).toBeDefined();
    await act(async () => button("Keep editing").onPress());
    expect(editor().props.value).toBe("Typed during save");
  }
  rpc.write.mockResolvedValueOnce({ path, modifiedMs: 40, hash: String(40).padStart(64, "0") });
  await act(async () => button("Save").onPress());
  await act(async () => tree!.unmount()); client.clear();
});

it.each([false, true])("lists task losses before enabling a reviewed replacement, compact=%s", async compact => {
  rpc.read.mockReset(); rpc.write.mockReset();
  const path = `data/loss-review-${compact}.md`;
  const original = "## In flight\n- [ ] finished - Work\n## Done\n";
  const theirs = "## In flight\n- [ ] added - Later task\n## Done\n- [x] finished - Work\n";
  const result = (content: string, hash: string) => ({ path, content, hash, modifiedMs: 10, binary: false, size: content.length, tooLarge: false });
  rpc.read.mockResolvedValueOnce(result(original, "a".repeat(64)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(createElement(QueryClientProvider, { client }, createElement(FilesView, {
    theme: attentionTheme, compact, request: { path, at: compact ? 4 : 3 },
  }))); });
  const button = (label: string) => tree.root.findAllByType("IconButton" as never).map(n => n.props as ComponentProps<typeof IconButton>).find(b => b.label === label)!;
  const compare = () => tree.root.findAllByType("Banner" as never).flatMap(n => (n.props as ComponentProps<typeof Banner>).actions ?? []).find(a => a.label === "Compare copies")!;
  await act(async () => tree.root.findByProps({ accessibilityLabel: `Edit ${path}` }).props.onChangeText(original + "\nMy edit"));
  rpc.write.mockRejectedValueOnce(new Error("File changed since you opened it"));
  await act(async () => button("Save").onPress());
  rpc.read.mockResolvedValueOnce(result(theirs, "b".repeat(64)));
  await act(async () => compare().onPress());
  expect(JSON.stringify(tree.toJSON())).toContain("Remove task: added - Later task");
  expect(JSON.stringify(tree.toJSON())).toContain("Mark unfinished again: finished - Work");
  expect(button("Replace with my text").disabled).toBe(true);
  await act(async () => button("Replace with my text").onPress());
  expect(rpc.write).toHaveBeenCalledTimes(1);
  await act(async () => tree.root.findByProps({ accessibilityRole: "checkbox" }).props.onPress());
  expect(button("Replace with my text").disabled).toBe(false);
  rpc.write.mockRejectedValueOnce(new Error("File changed since you opened it"));
  await act(async () => button("Replace with my text").onPress());
  expect(rpc.write).toHaveBeenLastCalledWith({ path, content: original + "\nMy edit", expectedHash: "b".repeat(64), force: true, reviewedLosses: fileLosses(theirs, original) });
  expect(tree.root.findByProps({ accessibilityLabel: `Edit ${path}` }).props.value).toBe(original + "\nMy edit");
  rpc.read.mockResolvedValueOnce(result(theirs + "- [ ] newer - Newest task\n", "c".repeat(64)));
  await act(async () => compare().onPress());
  expect(button("Replace with my text").disabled).toBe(true);
  await act(async () => tree.root.findByProps({ accessibilityRole: "checkbox" }).props.onPress());
  rpc.write.mockResolvedValueOnce({ path, hash: "d".repeat(64), modifiedMs: 20 });
  await act(async () => button("Replace with my text").onPress());
  await act(async () => tree.unmount()); client.clear();
});
