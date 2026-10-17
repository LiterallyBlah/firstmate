// Stand-in CLI. This file never connects to a daemon.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const [statePath, logPath, ...args] = process.argv.slice(2);
appendFileSync(logPath, JSON.stringify(args) + "\n");
const state = JSON.parse(readFileSync(statePath, "utf8"));
if (state.delay) await new Promise(done => setTimeout(done, state.delay));
const value = flag => args[args.indexOf(flag) + 1];
if (state.fail === args[0]) { console.error("Scripted read failure"); process.exit(1); }
let result;
switch (args[0]) {
  case "project": result = state.projects; break;
  case "provider": result = state.models; break;
  case "workspace": result = state.workspaces; break;
  case "inspect": result = state.agents.find(agent => agent.id === args[1])?.detail; if (!result) process.exit(1); break;
  case "ls": {
    let agents = state.agents;
    for (let i = 0; i < args.length; i++) if (args[i] === "--label") {
      const label = args[++i], at = label.indexOf("=");
      agents = agents.filter(agent => agent.labels[label.slice(0, at)] === label.slice(at + 1));
    }
    result = agents.map(agent => ({ id: agent.id, cwd: agent.detail.Cwd, status: "idle" }));
    break;
  }
  case "run": {
    if (["ok", "explicit-found"].includes(state.runBehavior)) {
      const labels = {};
      for (let i = 0; i < args.length; i++) if (args[i] === "--label") { const label = args[++i], at = label.indexOf("="); labels[label.slice(0, at)] = label.slice(at + 1); }
      const provider = value("--provider").split("/");
      state.agents.push({ id: state.workerId, labels, detail: { Id: state.workerId, ParentAgentId: null, Cwd: state.workspaces[0].cwd, Provider: provider[0], Model: provider.slice(1).join("/"), Mode: value("--mode"), Thinking: value("--thinking"), Archived: false } });
      writeFileSync(statePath, JSON.stringify(state));
    }
    if (state.runBehavior !== "ok") {
      console.error(state.runBehavior === "timeout" ? "Remote request timed out; outcome is uncertain" : "Remote command failed: invalid mode"); process.exit(1);
    }
    result = { agentId: state.workerId, workspaceId: state.workspaces[0].workspaceId };
    break;
  }
  default: console.error("Unexpected stand-in command"); process.exit(1);
}
console.log(JSON.stringify(result));
