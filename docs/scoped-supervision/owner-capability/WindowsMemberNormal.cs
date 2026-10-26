// Test-only v4 normal entry. Existing exact-two and root-only entries are unchanged.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public sealed partial class FirstMateJobCapability {
    static Dictionary<string, object> MemberRead(string directory, string name, Dictionary<string, object> committed) {
        byte[] bytes;
        using (var file = new FileStream(Path.Combine(directory, name), FileMode.Open, FileAccess.Read, FileShare.Read)) {
            var buffer = new byte[4097]; int count = 0, read;
            while (count < buffer.Length && (read = file.Read(buffer, count, buffer.Length - count)) > 0) count += read;
            if (count == 0 || count > 4096) throw new InvalidOperationException("Committed entry exceeds 4096-byte bound");
            bytes = new byte[count]; Array.Copy(buffer, bytes, count);
        }
        // Raw bytes are retained before parsing/guards; a partial or malformed commit never supplies a role.
        committed[name] = D("rawBase64", Convert.ToBase64String(bytes));
        var parser = new JavaScriptSerializer(); parser.MaxJsonLength = 4096; parser.RecursionLimit = 8;
        var value = parser.DeserializeObject(new UTF8Encoding(false, true).GetString(bytes)) as Dictionary<string, object>;
        if (value == null) throw new InvalidOperationException("Committed entry is not an object");
        ((Dictionary<string, object>)committed[name])["value"] = value; return value;
    }
    static long MemberPid(Dictionary<string, object> value, string key) {
        object raw; if (!value.TryGetValue(key, out raw) || !(raw is int || raw is long)) throw new InvalidOperationException("Missing committed PID: " + key);
        long pid = Convert.ToInt64(raw); if (pid <= 0 || pid > UInt32.MaxValue) throw new InvalidOperationException("Invalid committed PID"); return pid;
    }
    static bool MemberText(Dictionary<string, object> value, string key, string expected) {
        object raw; return value.TryGetValue(key, out raw) && raw is string && (string)raw == expected;
    }
    static bool MemberInstance(Dictionary<string, object> value) {
        object raw; Guid parsed;
        if (!value.TryGetValue("instance", out raw) || !(raw is string)) return false;
        string text = (string)raw;
        return Guid.TryParseExact(text, "D", out parsed) && text.Length == 36 && text[14] == '4' && "89ab".Contains(text.Substring(19, 1).ToLowerInvariant());
    }
    static bool MemberEntry(Dictionary<string, object> value, string caseId, string nonce, string version) {
        object thread, main;
        return MemberText(value, "caseId", caseId) && MemberText(value, "nonce", nonce) && MemberText(value, "scenario", "normal") &&
            MemberText(value, "node", version) && MemberInstance(value) && value.TryGetValue("threadId", out thread) && thread is int && (int)thread == 0 &&
            value.TryGetValue("isMainThread", out main) && main is bool && (bool)main;
    }
    void MemberGuard(Dictionary<string, object> members, bool rootRequired) {
        if (!Ok(members, "complete") || (uint)members["total"] > 8 || (uint)members["total"] != gateLifetimes.Count ||
            (rootRequired && !((List<long>)members["pids"]).Contains(root.Pid)) || lifetimeOverflow != 0 || replacementDetected ||
            gateLifetimes.Exists(life => !life.Bound || !life.Continuous) || recordDropped != 0 || recordFailures != 0) {
            Offending(members); throw new InvalidOperationException("Incomplete bounded owned-member lifetimes");
        }
    }
    public static Dictionary<string, object> QualifyMemberNormalV4(string node, string entry, string config, string directory, string caseId, string nonce, string version) {
        if (Path.GetFileName(entry) != "root.mjs") throw new ArgumentException("Unchanged fixed normal workload required");
        var owner = new FirstMateJobCapability();
        // Reuse only the reviewed held-lifetime capture machinery. This is an explicit v4/v3 normal contract, never a v3 root-gate receipt.
        owner.rootGate = true;
        var committed = D();
        var receipt = D("scenario", "normal", "contract", "required-workload-and-owned-set/1", "captureVersion", 4, "diagnosticVersion", 3,
            "error", null, "originalFailure", null, "originalFailureTruncated", false, "targetCreated", false, "targetResumed", false,
            "committedEntries", committed, "workloadBindings", null, "normalExited", false);
        Timer timer = null; bool timerDrained = true; IntPtr environment = IntPtr.Zero;
        try {
            owner.Acquire(); receipt["freshOwner"] = owner.lastComplete;
            if ((uint)owner.lastComplete["total"] != 0 || (uint)owner.lastComplete["active"] != 0) throw new InvalidOperationException("Normal owner not fresh");
            var startup = new StartupEx(); startup.Basic.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Attributes = owner.attributes;
            receipt["standardWiring"] = owner.PrepareStandardHandles(ref startup);
            string systemRoot = Environment.GetEnvironmentVariable("SystemRoot"); if (String.IsNullOrEmpty(systemRoot)) throw new InvalidOperationException("Missing SystemRoot");
            environment = Marshal.StringToHGlobalUni("SystemRoot=" + systemRoot + "\0TEMP=" + directory + "\0TMP=" + directory + "\0\0");
            timer = new Timer(delegate { owner.deadlineFired = true; owner.Step("member normal deadline", delegate { owner.Terminate("independent-parent-deadline"); }); }, null, 5000, Timeout.Infinite);
            owner.Note("deadline-armed", D("durationMs", 5000)); ProcessInfo created;
            bool ok = CreateProcessW(node, new StringBuilder(Quote(node) + " " + Quote(entry) + " " + Quote(config)), IntPtr.Zero, IntPtr.Zero,
                true, Suspended | UnicodeEnvironment | NoWindow | 0x80000, environment, directory, ref startup, out created);
            if (!ok) { int error = Marshal.GetLastWin32Error(); owner.AcquisitionFailed("root", error); owner.AcquisitionFailed("thread", error); throw new Win32Exception(error, "Create owned normal root"); }
            owner.root = created; receipt["targetCreated"] = true; var rootLife = owner.GateAdopt("root", created.Process); owner.Own("thread", created.Thread);
            owner.GateBindLive(rootLife); owner.CloseParentWriters(); var before = owner.Members("before-resume"); receipt["beforeResume"] = before;
            owner.MemberGuard(before, true); owner.Note("suspended-root-owned", rootLife.Ref());
            if (owner.deadlineFired) throw new TimeoutException("Deadline before normal resume");
            uint previous = ResumeThread(created.Thread); Require(previous != UInt32.MaxValue, "Resume normal root"); if (previous != 1) throw new InvalidOperationException("Unexpected suspend count");
            receipt["targetResumed"] = true; owner.Note("root-resumed", D("previousSuspendCount", previous)); owner.FreeAttributes();
            bool rolesBound = false;
            while (!owner.deadlineFired) {
                var members = owner.Members("normal-live"); receipt["liveMembers"] = members; owner.MemberGuard(members, true);
                if (File.Exists(Path.Combine(directory, "root-pre-spawn.json")) && File.Exists(Path.Combine(directory, "root-entry.json")) && File.Exists(Path.Combine(directory, "child-entry.json"))) {
                    var pre = MemberRead(directory, "root-pre-spawn.json", committed); var parent = MemberRead(directory, "root-entry.json", committed); var descendant = MemberRead(directory, "child-entry.json", committed);
                    long childPid = MemberPid(descendant, "pid");
                    if (!MemberEntry(parent, caseId, nonce, version) || !MemberEntry(descendant, caseId, nonce, version) || !MemberEntry(pre, caseId, nonce, version) ||
                        MemberPid(parent, "pid") != created.Pid || MemberPid(pre, "pid") != created.Pid || MemberPid(parent, "childPid") != childPid ||
                        MemberPid(parent, "ppid") != Process.GetCurrentProcess().Id || MemberPid(pre, "ppid") != MemberPid(parent, "ppid") || MemberPid(descendant, "ppid") != created.Pid ||
                        !Object.Equals(parent["instance"], pre["instance"]) || Object.Equals(parent["instance"], descendant["instance"]) ||
                        !MemberText(pre, "format", "firstmate.root-pre-spawn/1") || !MemberText(pre, "stage", "before-child-spawn") ||
                        !MemberText(pre, "childEntry", Path.Combine(Path.GetDirectoryName(entry), "child.mjs"))) throw new InvalidOperationException("Uncorrelated committed workload entries");
                    var expected = owner.gateLifetimes.Find(life => life.Initial != null && Convert.ToInt64(((Dictionary<string, object>)life.Initial["identity"])["pid"]) == childPid);
                    if (expected == null || expected == rootLife || !expected.Bound || !MemberText((Dictionary<string, object>)expected.Initial["identity"], "image", node) ||
                        !MemberText((Dictionary<string, object>)rootLife.Initial["identity"], "image", node) || !((List<long>)members["pids"]).Contains(childPid))
                        throw new InvalidOperationException("Expected committed child has no live immutable member binding");
                    receipt["workloadBindings"] = D("root", rootLife.Ref(), "expectedChild", expected.Ref());
                    owner.Note("required-workload-bound", D("bindings", receipt["workloadBindings"], "members", members)); rolesBound = true; break;
                }
                Thread.Sleep(10);
            }
            if (!rolesBound || owner.deadlineFired) throw new TimeoutException("No committed workload roles before deadline");
            File.WriteAllText(Path.Combine(directory, "release"), "owned-workload-confirmed"); owner.Note("normal-release", D("workloadBindings", receipt["workloadBindings"]));
            var closure = Stopwatch.StartNew();
            while (closure.ElapsedMilliseconds < 8000 && !owner.deadlineFired) {
                var members = owner.Members("success-terminal"); receipt["lastNormalMembers"] = members; owner.MemberGuard(members, false);
                if ((uint)members["active"] == 0) { receipt["normalExited"] = true; owner.Note("normal-owned-set-empty", members); break; }
                Thread.Sleep(10);
            }
            if (!(bool)receipt["normalExited"] || owner.deadlineFired) throw new TimeoutException("Normal owned-set deadline");
        } catch (Exception ex) {
            string error = ex.GetType().Name + ": " + ex.Message; receipt["originalFailureTruncated"] = error.Length > 4096;
            receipt["error"] = error.Substring(0, Math.Min(error.Length, 4096)); receipt["originalFailure"] = receipt["error"];
        } finally {
            if (owner.job != IntPtr.Zero && (bool)receipt["targetCreated"] && !(bool)receipt["normalExited"]) owner.Step("member failure stop", delegate { owner.Terminate("failed-prerequisite-cleanup"); });
            if (timer != null) { timerDrained = false; owner.Step("member timer disposal", delegate { using (var drained = new ManualResetEvent(false)) { timer.Dispose(drained); timerDrained = drained.WaitOne(1000); } }); }
            if (owner.job != IntPtr.Zero) owner.Step("member terminal capture", owner.GateTerminalCapture);
            owner.CloseParentWriters(); var outputs = D();
            if (owner.stdout != null) owner.Step("member stdout drain", delegate { outputs["stdout"] = owner.stdout.Finish(); });
            if (owner.stderr != null) owner.Step("member stderr drain", delegate { outputs["stderr"] = owner.stderr.Finish(); }); receipt["rootOutput"] = outputs;
            owner.Step("member attributes", owner.FreeAttributes); if (environment != IntPtr.Zero) owner.Step("member environment", delegate { Marshal.FreeHGlobal(environment); });
            foreach (var life in owner.gateLifetimes) { var current = life; owner.Step("member process close", delegate { if (!current.Closed) current.Closed = owner.GateClose(current.Role, current.Handle); }); }
            if (owner.root.Process != IntPtr.Zero && !owner.gateLifetimes.Exists(value => value.Handle == owner.root.Process)) owner.Step("unrecorded member root close", delegate { owner.GateClose("root", owner.root.Process); });
            bool threadClosed = false, jobClosed = false, inputClosed = false;
            owner.Step("member thread close", delegate { threadClosed = owner.GateClose("thread", owner.root.Thread); });
            if (timerDrained) owner.Step("member job close", delegate { jobClosed = owner.GateClose("job", owner.job); });
            owner.Step("member stdin close", delegate { inputClosed = owner.GateClose("stdin", owner.input); });
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
