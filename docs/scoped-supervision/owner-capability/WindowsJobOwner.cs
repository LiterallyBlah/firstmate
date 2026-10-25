// Test-only public Win32 interop. Not a plugin/runtime owner or an authentication boundary.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class FirstMateJobCapability {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking;
        public uint ActiveLimit; public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public uint Size; public string Reserved, Desktop, Title; public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Basic; public IntPtr Attributes; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool inside);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, uint count, uint flags, ref UIntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, UIntPtr attribute, IntPtr value, UIntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetProcessId(IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] static extern IntPtr GetProcAddress(IntPtr module, string name);

    const uint KillOnClose = 0x2000, Suspended = 4, UnicodeEnvironment = 0x400, NoWindow = 0x08000000, TerminatedCode = 197;
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly List<Dictionary<string, object>> events = new List<Dictionary<string, object>>();
    readonly object gate = new object();
    IntPtr job, attributes, jobValue, child; ProcessInfo root;
    bool attributesInitialized;
    volatile bool deadlineFired, terminateRequested, terminateReturned;
    int terminationError, terminationStarted; double terminationAt;

    static Dictionary<string, object> D(params object[] pairs) {
        var value = new Dictionary<string, object>();
        for (int i = 0; i < pairs.Length; i += 2) value.Add((string)pairs[i], pairs[i + 1]);
        return value;
    }
    void Note(string kind, object data) { lock (gate) { if (events.Count >= 64) throw new InvalidOperationException("Parent event bound"); events.Add(D("kind", kind, "atMs", clock.Elapsed.TotalMilliseconds, "data", data)); } }
    static void Require(bool success, string operation) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static string H(IntPtr value) { return "0x" + value.ToInt64().ToString("x"); }
    T Query<T>(int kind) {
        int size = Marshal.SizeOf(typeof(T)); IntPtr buffer = Marshal.AllocHGlobal(size);
        try { uint returned; Require(QueryInformationJobObject(job, kind, buffer, (uint)size, out returned), "Query job " + kind); return (T)Marshal.PtrToStructure(buffer, typeof(T)); }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    Dictionary<string, object> Members() {
        // Fixed small owner, never a best-effort/truncated process list.
        int size = 8 + 8 * IntPtr.Size; IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            uint returned; Require(QueryInformationJobObject(job, 3, buffer, (uint)size, out returned), "Query complete member list");
            uint assignedCount = (uint)Marshal.ReadInt32(buffer), listed = (uint)Marshal.ReadInt32(buffer, 4);
            if (listed > 8 || listed != assignedCount) throw new InvalidOperationException("Incomplete job membership");
            var pids = new List<long>(); for (int i = 0; i < listed; i++) pids.Add(Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64());
            var accounting = Query<Accounting>(1);
            return D("assigned", assignedCount, "listed", listed, "pids", pids, "active", accounting.Active, "total", accounting.Total);
        } finally { Marshal.FreeHGlobal(buffer); }
    }
    Dictionary<string, object> Identity(IntPtr process) {
        uint pid = GetProcessId(process); Require(pid != 0, "GetProcessId");
        long creation, exit, kernel, user; Require(GetProcessTimes(process, out creation, out exit, out kernel, out user), "GetProcessTimes");
        var image = new StringBuilder(32768); uint size = (uint)image.Capacity;
        Require(QueryFullProcessImageNameW(process, 0, image, ref size), "Query process image");
        bool member; Require(IsProcessInJob(process, job, out member), "Check actual handle membership");
        return D("pid", pid, "handle", H(process), "creationFileTime", creation.ToString(), "image", image.ToString(), "member", member);
    }
    void Acquire() {
        if (IntPtr.Size != 8 || Marshal.SizeOf(typeof(ExtendedLimits)) != 144 || Marshal.SizeOf(typeof(Accounting)) != 48 || Marshal.SizeOf(typeof(Startup)) != 104 || Marshal.SizeOf(typeof(StartupEx)) != 112)
            throw new PlatformNotSupportedException("Only verified x64 structure layout is supported");
        foreach (string name in new [] { "CreateJobObjectW", "SetInformationJobObject", "QueryInformationJobObject", "AssignProcessToJobObject", "IsProcessInJob", "TerminateJobObject", "CreateProcessW", "InitializeProcThreadAttributeList", "UpdateProcThreadAttribute", "DeleteProcThreadAttributeList", "ResumeThread", "TerminateProcess", "OpenProcess", "GetProcessId", "GetProcessTimes", "QueryFullProcessImageNameW", "GetExitCodeProcess", "WaitForSingleObject", "CloseHandle" })
            if (GetProcAddress(GetModuleHandleW("kernel32.dll"), name) == IntPtr.Zero) throw new PlatformNotSupportedException("Missing export " + name);
        job = CreateJobObjectW(IntPtr.Zero, null); Require(job != IntPtr.Zero, "Create unnamed job");
        var limits = new ExtendedLimits(); limits.Basic.Flags = KillOnClose;
        Require(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "Set kill-on-close, no breakaway");
        var observed = Query<ExtendedLimits>(9);
        if (observed.Basic.Flags != KillOnClose) throw new InvalidOperationException("Unexpected owner limits");
        bool inOuter; Require(IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inOuter), "Read helper outer job status");
        Note("owner-acquired", D("handle", H(job), "flags", observed.Basic.Flags, "helperPid", GetProcessId(GetCurrentProcess()), "helperInOuterJob", inOuter, "members", Members()));
        UIntPtr sizeNeeded = UIntPtr.Zero;
        bool sizing = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref sizeNeeded);
        if (sizing || Marshal.GetLastWin32Error() != 122 || sizeNeeded.ToUInt64() == 0 || sizeNeeded.ToUInt64() > 65536) throw new InvalidOperationException("Unexpected attribute sizing result");
        attributes = Marshal.AllocHGlobal((int)sizeNeeded.ToUInt64());
        Require(InitializeProcThreadAttributeList(attributes, 1, 0, ref sizeNeeded), "Initialize process attributes"); attributesInitialized = true;
        jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
        // ProcThreadAttributeValue(JobList=13, thread=false, input=true, additive=false), public Windows SDK.
        Require(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x2000d), jobValue, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Set creation-time job list");
        Note("creation-owner-configured", D("attribute", "PROC_THREAD_ATTRIBUTE_JOB_LIST", "targetCreated", false));
    }
    void FreeAttributes() {
        if (attributesInitialized) { DeleteProcThreadAttributeList(attributes); attributesInitialized = false; }
        if (attributes != IntPtr.Zero) { Marshal.FreeHGlobal(attributes); attributes = IntPtr.Zero; }
        if (jobValue != IntPtr.Zero) { Marshal.FreeHGlobal(jobValue); jobValue = IntPtr.Zero; }
    }
    public static Dictionary<string, object> Preflight() {
        var owner = new FirstMateJobCapability(); string error = null;
        try { owner.Acquire(); } catch (Exception ex) { error = ex.GetType().Name + ": " + ex.Message; }
        owner.FreeAttributes(); bool closed = owner.job == IntPtr.Zero || CloseHandle(owner.job);
        return D("available", error == null && closed, "targetCreated", false, "error", error, "jobClosed", closed, "events", owner.events);
    }
    static string Quote(string value) {
        if (value.IndexOf('"') >= 0 || value.IndexOf('\0') >= 0 || value.EndsWith("\\")) throw new ArgumentException("Unsupported fixture argument");
        return "\"" + value + "\""; // absolute executable/file paths; rejects embedded quotes and terminal backslash
    }
    void Terminate(string reason) {
        if (Interlocked.CompareExchange(ref terminationStarted, 1, 0) != 0) return;
        terminateRequested = true; terminationAt = clock.Elapsed.TotalMilliseconds;
        terminateReturned = TerminateJobObject(job, TerminatedCode); terminationError = terminateReturned ? 0 : Marshal.GetLastWin32Error();
        Note("termination", D("reason", reason, "returned", terminateReturned, "win32Error", terminationError));
    }
    public static Dictionary<string, object> Run(string node, string entry, string config, string directory, string scenario) {
        if (scenario != "normal" && scenario != "blocked") throw new ArgumentException("Only the two named synthetic cases are permitted");
        var owner = new FirstMateJobCapability(); var receipt = D("scenario", scenario, "error", null, "targetCreated", false, "targetResumed", false);
        Timer timer = null; bool timerDrained = true; IntPtr environment = IntPtr.Zero;
        try {
            owner.Acquire(); // includes successful creation-time job attribute before CreateProcess
            var startup = new StartupEx(); startup.Basic.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Attributes = owner.attributes;
            string systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
            if (String.IsNullOrEmpty(systemRoot)) throw new InvalidOperationException("Missing SystemRoot");
            environment = Marshal.StringToHGlobalUni("SystemRoot=" + systemRoot + "\0TEMP=" + directory + "\0TMP=" + directory + "\0\0");
            timer = new Timer(delegate { owner.deadlineFired = true; owner.Terminate("independent-parent-deadline"); }, null, 5000, Timeout.Infinite);
            owner.Note("deadline-armed", D("durationMs", 5000, "thread", "parent CLR timer, outside owned job"));
            Require(CreateProcessW(node, new StringBuilder(Quote(node) + " " + Quote(entry) + " " + Quote(config)), IntPtr.Zero, IntPtr.Zero,
                false, Suspended | UnicodeEnvironment | NoWindow | 0x80000, environment, directory, ref startup, out owner.root), "Create suspended root assigned at creation");
            receipt["targetCreated"] = true;
            var rootIdentity = owner.Identity(owner.root.Process);
            var initial = owner.Members();
            if (!(bool)rootIdentity["member"] || (uint)initial["active"] != 1 || (uint)initial["listed"] != 1 || ((List<long>)initial["pids"])[0] != owner.root.Pid)
                throw new InvalidOperationException("Missing pre-execution root membership");
            receipt["root"] = rootIdentity; receipt["beforeResume"] = initial;
            owner.Note("suspended-root-owned", rootIdentity);
            if (owner.deadlineFired) throw new TimeoutException("Deadline before root resume");
            uint previous = ResumeThread(owner.root.Thread); Require(previous != UInt32.MaxValue, "Resume owned root");
            if (previous != 1) throw new InvalidOperationException("Unexpected suspend count");
            receipt["targetResumed"] = true; owner.Note("root-resumed", D("previousSuspendCount", previous));
            owner.FreeAttributes();
            Dictionary<string, object> pair = null;
            while (!owner.deadlineFired) {
                var members = owner.Members(); var pids = (List<long>)members["pids"];
                if (pids.Count > 2 || !pids.Contains(owner.root.Pid)) throw new InvalidOperationException("Unexpected live owned set");
                if (pids.Count == 2 && File.Exists(Path.Combine(directory, "root-entry.json")) && File.Exists(Path.Combine(directory, "child-entry.json"))) {
                    long pid = pids[0] == owner.root.Pid ? pids[1] : pids[0];
                    if (pid <= 0 || pid > UInt32.MaxValue) throw new InvalidOperationException("Invalid member PID");
                    owner.child = OpenProcess(0x00100000 | 0x1000, false, (uint)pid); Require(owner.child != IntPtr.Zero, "Open actual descendant member handle");
                    var childIdentity = owner.Identity(owner.child);
                    if (!(bool)childIdentity["member"] || (uint)childIdentity["pid"] != pid || WaitForSingleObject(owner.child, 0) != 258 || WaitForSingleObject(owner.root.Process, 0) != 258)
                        throw new InvalidOperationException("Unbound or nonlive owned handles");
                    pair = owner.Members();
                    if ((uint)pair["active"] != 2 || (uint)pair["listed"] != 2 || (uint)pair["total"] != 2) throw new InvalidOperationException("Incomplete pair membership/accounting");
                    receipt["child"] = childIdentity; receipt["liveMembers"] = pair;
                    owner.Note("root-and-descendant-bound", D("root", rootIdentity, "child", childIdentity, "members", pair)); break;
                }
                Thread.Sleep(10);
            }
            if (pair == null) throw new TimeoutException("No confirmed root/descendant pair before deadline");
            if (scenario == "normal") { File.WriteAllText(Path.Combine(directory, "release"), "owned-pair-confirmed"); owner.Note("normal-release", D("membersConfirmed", true)); }
            double closeLimit = owner.clock.Elapsed.TotalMilliseconds + 8000;
            while (owner.clock.Elapsed.TotalMilliseconds < closeLimit) {
                var members = owner.Members();
                if ((uint)members["active"] == 0 && (uint)members["listed"] == 0 && WaitForSingleObject(owner.root.Process, 0) == 0 && WaitForSingleObject(owner.child, 0) == 0) {
                    uint rootCode, childCode; Require(GetExitCodeProcess(owner.root.Process, out rootCode), "Root exit code"); Require(GetExitCodeProcess(owner.child, out childCode), "Child exit code");
                    receipt["finalMembers"] = members; receipt["rootWait"] = 0; receipt["childWait"] = 0; receipt["rootExit"] = rootCode; receipt["childExit"] = childCode;
                    owner.Note("owned-set-closed", D("members", members, "rootExit", rootCode, "childExit", childCode)); break;
                }
                Thread.Sleep(10);
            }
            if (!receipt.ContainsKey("finalMembers")) throw new TimeoutException("Owned-set closure not confirmed");
        } catch (Exception ex) {
            receipt["error"] = ex.GetType().Name + ": " + ex.Message;
            if (owner.job != IntPtr.Zero && (bool)receipt["targetCreated"]) owner.Terminate("failed-prerequisite-cleanup");
        } finally {
            if (timer != null) using (var drained = new ManualResetEvent(false)) { timer.Dispose(drained); timerDrained = drained.WaitOne(1000); }
            owner.FreeAttributes(); if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
            // A failed receipt never permits reuse. Closing this noninherited job handle retains kill-on-close protection.
            bool threadClosed = owner.root.Thread == IntPtr.Zero || CloseHandle(owner.root.Thread);
            bool childClosed = owner.child == IntPtr.Zero || CloseHandle(owner.child);
            bool rootClosed = owner.root.Process == IntPtr.Zero || CloseHandle(owner.root.Process);
            bool jobClosed = owner.job == IntPtr.Zero || (timerDrained && CloseHandle(owner.job));
            receipt["cleanup"] = D("timerDrained", timerDrained, "threadHandleClosed", threadClosed, "childHandleClosed", childClosed, "rootHandleClosed", rootClosed, "jobHandleClosed", jobClosed);
        }
        receipt["deadlineFired"] = owner.deadlineFired; receipt["terminateRequested"] = owner.terminateRequested;
        receipt["terminateReturned"] = owner.terminateReturned; receipt["terminationError"] = owner.terminationError; receipt["terminationAtMs"] = owner.terminationAt;
        receipt["events"] = owner.events;
        return receipt;
    }
}
