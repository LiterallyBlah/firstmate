import { fleet } from "../board-list/fixtures.js";
// `?mate=running` draws the first mate mid-turn, as the captain saw it.
const status = new URLSearchParams(location.search).get("mate");
if (status) Object.assign(fleet.mate, { status, requiresAttention: false });
