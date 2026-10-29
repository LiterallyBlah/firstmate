/** Query state and source readiness are separate: a delay is never an error. */
export interface DecisionReadState {
  pending?: boolean;
  fetching?: boolean;
  error?: boolean;
  pendingSince?: number | undefined;
  readiness?: "loading" | "complete" | "partial" | "failed";
}

/** The bounded read service can supply readiness without changing count consumers. */
export function decisionReadState(query: { isPending?: boolean; isFetching?: boolean; error?: unknown; pendingSince?: number | undefined }): DecisionReadState {
  return { pending: query.isPending === true, fetching: query.isFetching === true, error: !!query.error, pendingSince: query.pendingSince };
}
