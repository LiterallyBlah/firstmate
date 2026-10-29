export * from "../board-list/stubs.jsx";
const original = "## In flight\n- [ ] pr9 - Review the files screen\n## Done\n";
const current = "## In flight\n- [ ] new-task - Keep the later work\n## Done\n- [x] pr9 - Review the files screen\n";
window.fileSaves = [];
let reads = 0;
const read = async () => ({ path: "data/backlog.md", content: ++reads === 1 ? original : current, hash: (reads === 1 ? "a" : "b").repeat(64), modifiedMs: 10, size: 100, binary: false, tooLarge: false });
const write = async input => { window.fileSaves.push(input); throw new Error("This file changed since you opened it. Your text is still here."); };
const list = async () => ({ path: "data", home: "fixture", entries: [] });
export const useRpc = contract => contract.name.endsWith(".read") ? read : contract.name.endsWith(".write") ? write : list;
