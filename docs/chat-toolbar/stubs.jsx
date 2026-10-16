export * from "../shell-phase1/stubs.jsx";
import { fleet } from "../board-list/fixtures.js";
const params = new URLSearchParams(location.search);
if (params.has("running")) fleet.mate.status = "running";
