export * from "../../board-list/stubs";
export function useRpc() { return async input => { window.migrationActions.push(input); throw new Error("Fixture only; no migration executes"); }; }
