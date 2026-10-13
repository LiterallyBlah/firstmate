export * from "../board-list/stubs.jsx";
export const useAgent = (id, select) => select({ id, title: "Guest chat" });
export const useWorkspace = (id, select) => select({ id, name: "FirstMate", directory: "/fixture/home" });
