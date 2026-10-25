// Source-only prepared test path. It is not a supported product owner or an authentication boundary.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed partial class FirstMateJobCapability {
    bool rootGate, replacementDetected; int lifetimeOverflow;
    readonly List<GateLifetime> gateLifetimes = new List<GateLifetime>();
    sealed class GateLifetime {
        public readonly string Role; public readonly int Sequence; public readonly IntPtr Handle;
        public Dictionary<string, object> Initial, Terminal; public bool InitialAttempted, Bound, Continuous = true, Closed;
        public GateLifetime(string role, int sequence, IntPtr handle) { Role = role; Sequence = sequence; Handle = handle; }
        public Dictionary<string, object> Ref() { return D("role", Role, "sequence", Sequence, "handle", H(Handle)); }
    }
    static bool Ok(Dictionary<string, object> value, string key) {
        return value.ContainsKey(key) && value[key] is bool && (bool)value[key];
    }
    GateLifetime GateAdopt(string role, IntPtr handle) {
        // Store the actual owned handle BEFORE observational work, so failed recording cannot skip its cleanup.
        foreach (var prior in gateLifetimes) if (prior.Handle == handle) { replacementDetected = true; prior.Continuous = false; ObservationError("duplicate actual root-gate handle"); return prior; }
        var life = new GateLifetime(role, gateLifetimes.Count + 1, handle); gateLifetimes.Add(life);
        foreach (var prior in gateLifetimes) if (prior != life && (prior.Role == role || prior.Handle == handle)) {
            replacementDetected = true; life.Continuous = false; ObservationError("replaced root-gate lifetime");
        }
        Own(role, handle); return life;
    }
    void GateBindLive(GateLifetime life) {
        if (life.InitialAttempted) { replacementDetected = true; life.Continuous = false; ObservationError("root-gate initial binding replay refused"); return; }
        life.InitialAttempted = true; // latch before any query; a failed first attempt is never repaired/replaced
        var value = ObserveProcess(life.Role, life.Handle); value["phase"] = "initial"; value["bindingRef"] = life.Ref();
        var queries = (Dictionary<string, object>)value["queries"];
        bool complete = true;
        foreach (string key in new [] { "pid", "creation", "image", "membership" }) {
            var query = (Dictionary<string, object>)queries[key]; query["attempted"] = true; complete = complete && Ok(query, "ok");
        }
        var identity = (Dictionary<string, object>)value["identity"]; var wait = (Dictionary<string, object>)value["wait"]; var exit = (Dictionary<string, object>)value["exit"];
        complete = complete && identity.ContainsKey("pid") && identity.ContainsKey("creationFileTime") && identity.ContainsKey("image") && Ok(identity, "member") &&
            Ok(wait, "ok") && wait.ContainsKey("result") && (uint)wait["result"] == 258 && Ok(exit, "ok");
        // A longer identity remains raw failure evidence; it is never truncated into a successful binding.
        if (identity.ContainsKey("image") && ((string)identity["image"]).Length > 1024) { complete = false; ObservationError("root-gate image exceeds admitted identity bound"); }
        life.Initial = value; life.Bound = complete && life.Continuous;
        ((Dictionary<string, object>)handleInventory[life.Role])["bindingRef"] = life.Ref();
        if (!life.Bound) ObservationError("incomplete initial root-gate binding");
    }
    void GateCaptureMembers(Dictionary<string, object> members) {
        if (root.Process == IntPtr.Zero || !Ok(members, "queryOk") || !members.ContainsKey("pids")) return;
        foreach (long pid in (List<long>)members["pids"]) {
            if (pid == root.Pid) continue;
            bool seen = false;
            foreach (var life in gateLifetimes) if (life.Initial != null) {
                var identity = (Dictionary<string, object>)life.Initial["identity"];
                if (identity.ContainsKey("pid") && Convert.ToInt64(identity["pid"]) == pid) seen = true;
            }
            foreach (var row in diagnosticMembers) if ((long)row["pid"] == pid) seen = true;
            if (seen) continue;
            if (gateLifetimes.Count >= 8 || diagnosticMembers.Count >= 7) { lifetimeOverflow++; ObservationError("root-gate lifetime bound exceeded"); continue; }
            string role = "gate-member-" + (diagnosticMembers.Count + 1);
            var attempt = D("role", role, "pid", pid, "acquisition", "never-acquired"); diagnosticMembers.Add(attempt);
            if (pid <= 0 || pid > UInt32.MaxValue) { ObservationError("invalid returned root-gate PID"); continue; }
            IntPtr handle = OpenProcess(0x00100000 | 0x1000, false, (uint)pid);
            if (handle == IntPtr.Zero) { int error = Marshal.GetLastWin32Error(); attempt["acquisition"] = "failed"; attempt["win32Error"] = error; AcquisitionFailed(role, error); ObservationError("root-gate OpenProcess: " + error); continue; }
            var acquired = GateAdopt(role, handle); attempt["acquisition"] = "acquired"; attempt["bindingRef"] = acquired.Ref();
            Step("root-gate member binding", delegate { GateBindLive(acquired); });
        }
    }
    Dictionary<string, object> GateObserveTerminal(GateLifetime life) {
        var queries = D("pid", D("attempted", true, "ok", false), "creation", D("attempted", true, "ok", false),
            "membership", D("attempted", true, "ok", false), "image", D("attempted", false, "reason", "terminal-retains-initial-binding", "bindingRef", life.Ref()));
        var identity = D(); var result = D("role", life.Role, "phase", "terminal", "bindingRef", life.Ref(), "identity", identity, "queries", queries,
            "wait", D("ok", false), "exit", D("ok", false), "state", "acquired");
        var inventory = (Dictionary<string, object>)handleInventory[life.Role];
        if (life.Closed || !life.Continuous || (string)inventory["handle"] != H(life.Handle) ||
            (life.Role == "root" && root.Process != life.Handle)) { life.Continuous = false; replacementDetected = true; ObservationError("root-gate handle continuity lost"); }
        Step("root-gate terminal identity", delegate {
            uint pid = GetProcessId(life.Handle); int error = pid == 0 ? Marshal.GetLastWin32Error() : 0;
            queries["pid"] = D("attempted", true, "ok", pid != 0, "win32Error", error); if (pid != 0) identity["pid"] = pid; else ObservationError("root-gate GetProcessId: " + error);
            long creation, exit, kernel, user; bool times = GetProcessTimes(life.Handle, out creation, out exit, out kernel, out user); error = times ? 0 : Marshal.GetLastWin32Error();
            queries["creation"] = D("attempted", true, "ok", times, "win32Error", error); if (times) identity["creationFileTime"] = creation.ToString(); else ObservationError("root-gate GetProcessTimes: " + error);
            bool member; bool membership = IsProcessInJob(life.Handle, job, out member); error = membership ? 0 : Marshal.GetLastWin32Error();
            queries["membership"] = D("attempted", true, "ok", membership, "win32Error", error); if (membership) identity["member"] = member; else ObservationError("root-gate IsProcessInJob: " + error);
        });
        Step("root-gate terminal wait", delegate {
            uint wait = WaitForSingleObject(life.Handle, 0); int error = wait == UInt32.MaxValue ? Marshal.GetLastWin32Error() : 0;
            result["wait"] = wait == UInt32.MaxValue ? D("ok", false, "win32Error", error) : D("ok", true, "result", wait);
            if (wait == UInt32.MaxValue) ObservationError("root-gate WaitForSingleObject: " + error);
            uint code; bool ok = GetExitCodeProcess(life.Handle, out code); error = ok ? 0 : Marshal.GetLastWin32Error();
            result["exit"] = ok ? D("ok", true, "code", code) : D("ok", false, "win32Error", error);
            if (!ok) ObservationError("root-gate GetExitCodeProcess: " + error);
        });
        if (life.Initial != null) {
            var initial = (Dictionary<string, object>)life.Initial["identity"];
            foreach (string key in new [] { "pid", "creationFileTime", "member" }) if (!identity.ContainsKey(key) || !initial.ContainsKey(key) || !Object.Equals(identity[key], initial[key])) ObservationError("root-gate terminal identity mismatch: " + key);
        }
        life.Terminal = result; inventory["observation"] = result; Note("gate-handle-observation", result); return result;
    }
    void GateTerminalCapture() {
        var closure = Stopwatch.StartNew();
        for (int sample = 0; sample < 8 && closure.ElapsedMilliseconds < 8000; sample++) {
            var members = ProbeMembers("terminal"); var observations = new List<Dictionary<string, object>>(); bool settled = true;
            foreach (var life in gateLifetimes) { var value = GateObserveTerminal(life); observations.Add(value); var wait = (Dictionary<string, object>)value["wait"]; settled = settled && Ok(wait, "ok") && wait.ContainsKey("result") && (uint)wait["result"] == 0; }
            terminalEvidence = D("members", members, "processes", observations); terminalSamples.Add(terminalEvidence);
            if (Ok(members, "complete") && members.ContainsKey("active") && (uint)members["active"] == 0 && settled) break;
            Thread.Sleep(10);
        }
    }
    bool GateClose(string role, IntPtr handle) {
        if (handle == IntPtr.Zero) return false;
        // Native disposal precedes and is independent of fallible diagnostic dictionary/sink work.
        bool closed = CloseHandle(handle); int error = closed ? 0 : Marshal.GetLastWin32Error();
        Step("record root-gate close", delegate {
            var inventory = (Dictionary<string, object>)handleInventory[role];
            inventory["disposition"] = closed ? "closed" : "close-failed";
            if (!closed) { inventory["closeError"] = error; ObservationError("root-gate CloseHandle: " + error); }
        });
        return closed;
    }
    public static Dictionary<string, object> QualifyRootGate(string node, string entry, string config, string directory) {
        // Public test entry only; the separate pinned controller requires its named dispatch file, absent during preparation.
        if (Path.GetFileName(entry) != "root-gate.mjs") throw new ArgumentException("Distinct fixed root gate entry required");
        var owner = new FirstMateJobCapability(); owner.rootGate = true;
        var receipt = D("scenario", "root-gate", "captureVersion", 3, "diagnosticVersion", 2, "error", null, "originalFailure", null, "originalFailureTruncated", false,
            "targetCreated", false, "targetResumed", false, "childSpawnReachable", false, "expectedChild", "not-part-of-root-gate", "stopReason", "unavailable", "markerObservedBeforeStop", false, "markerReadback", null);
        Timer timer = null; bool timerDrained = true; IntPtr environment = IntPtr.Zero;
        try {
            owner.Acquire(); receipt["freshOwner"] = owner.lastComplete;
            if ((uint)owner.lastComplete["total"] != 0 || (uint)owner.lastComplete["active"] != 0) throw new InvalidOperationException("Root-gate owner not fresh");
            var startup = new StartupEx(); startup.Basic.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Attributes = owner.attributes;
            receipt["standardWiring"] = owner.PrepareStandardHandles(ref startup);
            string systemRoot = Environment.GetEnvironmentVariable("SystemRoot"); if (String.IsNullOrEmpty(systemRoot)) throw new InvalidOperationException("Missing SystemRoot");
            environment = Marshal.StringToHGlobalUni("SystemRoot=" + systemRoot + "\0TEMP=" + directory + "\0TMP=" + directory + "\0\0");
            timer = new Timer(delegate { owner.deadlineFired = true; owner.Step("root-gate deadline", delegate { owner.Terminate("independent-parent-deadline"); }); }, null, 5000, Timeout.Infinite);
            owner.Note("deadline-armed", D("durationMs", 5000)); ProcessInfo created;
            bool ok = CreateProcessW(node, new StringBuilder(Quote(node) + " " + Quote(entry) + " " + Quote(config)), IntPtr.Zero, IntPtr.Zero,
                true, Suspended | UnicodeEnvironment | NoWindow | 0x80000, environment, directory, ref startup, out created);
            if (!ok) { int error = Marshal.GetLastWin32Error(); owner.AcquisitionFailed("root", error); owner.AcquisitionFailed("thread", error); throw new Win32Exception(error, "Create owned root gate"); }
            owner.root = created; receipt["targetCreated"] = true; var rootLife = owner.GateAdopt("root", created.Process); owner.Own("thread", created.Thread);
            owner.GateBindLive(rootLife); owner.CloseParentWriters(); var before = owner.Members("before-resume"); receipt["beforeResume"] = before;
            if (!rootLife.Bound || (uint)before["total"] != 1 || (uint)before["active"] != 1) { receipt["gateSnapshot"] = before; receipt["stopReason"] = "unexpected-before-resume"; }
            else {
                if (owner.deadlineFired) throw new TimeoutException("Deadline before gate resume");
                uint previous = ResumeThread(created.Thread); Require(previous != UInt32.MaxValue, "Resume root gate"); if (previous != 1) throw new InvalidOperationException("Unexpected suspend count");
                receipt["targetResumed"] = true; owner.Note("root-resumed", D("previousSuspendCount", previous)); owner.FreeAttributes();
                while (!owner.deadlineFired) {
                    // The existing iteration query follows marker observation; an earlier query cannot establish this checkpoint.
                    bool markerObserved = File.Exists(Path.Combine(directory, "root-pre-spawn.json"));
                    if (markerObserved) { receipt["markerObservedBeforeStop"] = true; owner.Note("gate-marker-observed", D("marker", "root-pre-spawn.json")); }
                    var members = owner.ProbeMembers(markerObserved ? "gate-post-marker" : "gate-live"); receipt["gateSnapshot"] = members;
                    if (markerObserved) receipt["markerReadback"] = D("order", "marker-observation-before-membership", "marker", "root-pre-spawn.json", "members", members);
                    if (!(bool)members["complete"]) { owner.Offending(members); throw new InvalidOperationException("Incomplete job membership"); }
                    var pids = (List<long>)members["pids"];
                    if (pids.Count != 1 || !pids.Contains(created.Pid) || (uint)members["total"] != 1) { receipt["stopReason"] = "unexpected-member"; break; }
                    if (markerObserved) { receipt["stopReason"] = "marker"; break; }
                    Thread.Sleep(10);
                }
                if (owner.deadlineFired) throw new TimeoutException("Root-gate marker deadline");
            }
        } catch (Exception ex) {
            string error = ex.GetType().Name + ": " + ex.Message; receipt["originalFailureTruncated"] = error.Length > 4096;
            receipt["error"] = error.Substring(0, Math.Min(error.Length, 4096)); receipt["originalFailure"] = receipt["error"]; receipt["stopReason"] = "failure";
        } finally {
            // Cleanup is independent of every observational/refusal result, including missing marker and failed binding.
            if (owner.job != IntPtr.Zero && (bool)receipt["targetCreated"]) owner.Step("root-gate stop", delegate { owner.Terminate("root-gate-" + receipt["stopReason"]); });
            if (timer != null) { timerDrained = false; owner.Step("root-gate timer disposal", delegate { using (var drained = new ManualResetEvent(false)) { timer.Dispose(drained); timerDrained = drained.WaitOne(1000); } }); }
            if (owner.job != IntPtr.Zero) owner.Step("root-gate terminal capture", owner.GateTerminalCapture);
            owner.CloseParentWriters(); var outputs = D();
            if (owner.stdout != null) owner.Step("root-gate stdout drain", delegate { outputs["stdout"] = owner.stdout.Finish(); });
            if (owner.stderr != null) owner.Step("root-gate stderr drain", delegate { outputs["stderr"] = owner.stderr.Finish(); }); receipt["rootOutput"] = outputs;
            owner.Step("root-gate attributes", owner.FreeAttributes); if (environment != IntPtr.Zero) owner.Step("root-gate environment", delegate { Marshal.FreeHGlobal(environment); });
            foreach (var life in owner.gateLifetimes) { var current = life; owner.Step("root-gate process close", delegate { if (!current.Closed) current.Closed = owner.GateClose(current.Role, current.Handle); }); }
            if (owner.root.Process != IntPtr.Zero && !owner.gateLifetimes.Exists(value => value.Handle == owner.root.Process)) owner.Step("unrecorded root close", delegate { owner.GateClose("root", owner.root.Process); });
            bool threadClosed = false, jobClosed = false, inputClosed = false;
            owner.Step("root-gate thread close", delegate { threadClosed = owner.GateClose("thread", owner.root.Thread); });
            if (timerDrained) owner.Step("root-gate job close", delegate { jobClosed = owner.GateClose("job", owner.job); });
            owner.Step("root-gate stdin close", delegate { inputClosed = owner.GateClose("stdin", owner.input); });
            receipt["stdinClosed"] = inputClosed; receipt["cleanup"] = D("timerDrained", timerDrained, "threadHandleClosed", threadClosed, "jobHandleClosed", jobClosed);
        }
        var lifetimes = new List<Dictionary<string, object>>();
        foreach (var life in owner.gateLifetimes) lifetimes.Add(D("bindingRef", life.Ref(), "bindingComplete", life.Bound, "continuous", life.Continuous, "initial", life.Initial, "terminal", life.Terminal, "closed", life.Closed));
        receipt["lifetimes"] = lifetimes; receipt["memberAcquisitions"] = owner.diagnosticMembers; receipt["lifetimeOverflow"] = owner.lifetimeOverflow; receipt["replacementDetected"] = owner.replacementDetected;
        receipt["handleInventory"] = owner.handleInventory; receipt["terminalEvidence"] = owner.terminalEvidence; receipt["terminalSamples"] = owner.terminalSamples;
        receipt["lastObservation"] = owner.lastObservation; receipt["events"] = owner.events;
        receipt["observation"] = D("dropped", owner.recordDropped, "failures", owner.recordFailures, "errors", owner.observationErrors);
        receipt["deadlineFired"] = owner.deadlineFired; receipt["terminateRequested"] = owner.terminateRequested; receipt["terminateReturned"] = owner.terminateReturned;
        receipt["terminationError"] = owner.terminationError; return receipt;
    }
}
