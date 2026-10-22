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

it.each([false, true])("recovers a failed read, preserves both conflict versions and guards unsaved navigation, compact=%s", async compact => {
  rpc.read.mockReset(); rpc.write.mockReset(); rpc.copy.mockClear();
  const path = `sample-${compact}.md`;
  const result = (content: string, modifiedMs: number) => ({ path, content, modifiedMs, binary: false, size: content.length, tooLarge: false });
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
  expect(rpc.write).toHaveBeenLastCalledWith({ path, content: "My unsaved text", expectedModifiedMs: 10, force: false });
  expect(action("Overwrite")).toBeDefined();
  expect(action("Load theirs")).toBeDefined(); // available before a listing poll
  await act(async () => action("Copy my text").onPress());
  expect(rpc.copy).toHaveBeenLastCalledWith("My unsaved text");
  expect(editor().props.value).toBe("My unsaved text");
  rpc.read.mockResolvedValueOnce(result("Their new text", 20));
  await act(async () => action("Load theirs").onPress());
  expect(editor().props.value).toBe("Their new text");
  await act(async () => editor().props.onChangeText("My second draft"));
  rpc.write.mockRejectedValueOnce(new Error("File changed since you opened it"));
  await act(async () => button("Save").onPress());
  let finishWrite!: (value: { modifiedMs: number }) => void;
  rpc.write.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
  await act(async () => { const overwrite = action("Overwrite"); overwrite.onPress(); overwrite.onPress(); });
  expect(rpc.write).toHaveBeenCalledTimes(3); // two checked conflicts and one deliberate overwrite
  expect(rpc.write).toHaveBeenLastCalledWith({ path, content: "My second draft", expectedModifiedMs: 20, force: true });
  await act(async () => { editor().props.onChangeText("Typed during save"); finishWrite({ modifiedMs: 30 }); });
  expect(editor().props.value).toBe("Typed during save");
  expect(JSON.stringify(tree!.toJSON())).toContain("Unsaved changes");
  if (compact) {
    await act(async () => button("Back to the files").onPress());
    expect(button("Keep editing")).toBeDefined();
    await act(async () => button("Keep editing").onPress());
    expect(editor().props.value).toBe("Typed during save");
  }
  rpc.write.mockResolvedValueOnce({ modifiedMs: 40 });
  await act(async () => button("Save").onPress());
  await act(async () => tree!.unmount()); client.clear();
});
