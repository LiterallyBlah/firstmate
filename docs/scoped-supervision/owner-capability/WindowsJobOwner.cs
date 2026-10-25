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
    [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes { public uint Size; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
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
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetHandleInformation(IntPtr handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr handle, [Out] byte[] buffer, uint size, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandleW(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] static extern IntPtr GetProcAddress(IntPtr module, string name);

    const uint KillOnClose = 0x2000, Suspended = 4, UnicodeEnvironment = 0x400, NoWindow = 0x08000000, TerminatedCode = 197;
    readonly Stopwatch clock = Stopwatch.StartNew();
    readonly List<Dictionary<string, object>> events = new List<Dictionary<string, object>>();
    readonly object gate = new object();
    readonly List<string> observationErrors = new List<string>();
    readonly Dictionary<string, object> handleInventory = D("root", D("acquisition", "never-acquired", "disposition", "not-attempted"),
        "child", D("acquisition", "never-acquired", "disposition", "not-attempted"), "thread", D("acquisition", "never-acquired", "disposition", "not-attempted"),
        "job", D("acquisition", "never-acquired", "disposition", "not-attempted"), "stdin", D("acquisition", "never-acquired", "disposition", "not-attempted"));
    readonly List<Dictionary<string, object>> terminalSamples = new List<Dictionary<string, object>>();
    Dictionary<string, object> lastComplete, previousComplete, lastCompleteBeforeFailure, lastObservation, offending, terminalEvidence;
    int recordDropped, recordFailures; string memberSignature;
    IntPtr inheritedHandles, input; NativeOutput stdout, stderr;
    IntPtr job, attributes, jobValue, child; ProcessInfo root;
    bool attributesInitialized;
    volatile bool deadlineFired, terminateRequested, terminateReturned;
    int terminationError, terminationStarted; double terminationAt;

    static Dictionary<string, object> D(params object[] pairs) {
        var value = new Dictionary<string, object>();
        for (int i = 0; i < pairs.Length; i += 2) value.Add((string)pairs[i], pairs[i + 1]);
        return value;
    }
    // Observation is bounded and must never replace the original failure or interrupt cleanup.
    void ObservationError(string message) { Interlocked.Increment(ref recordFailures); try { lock (gate) { if (observationErrors.Count < 8) observationErrors.Add(message.Substring(0, Math.Min(message.Length, 300))); } } catch {} }
    void Note(string kind, object data) { try { lock (gate) { if (events.Count >= 64) { recordDropped++; return; } events.Add(D("kind", kind, "atMs", clock.Elapsed.TotalMilliseconds, "data", data)); } } catch (Exception ex) { ObservationError(ex.Message); } }
    void Step(string name, Action work) { try { work(); } catch (Exception ex) { ObservationError(name + ": " + ex.Message); } }
    static void Require(bool success, string operation) { if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
    static string H(IntPtr value) { return "0x" + value.ToInt64().ToString("x"); }
    T Query<T>(int kind) {
        int size = Marshal.SizeOf(typeof(T)); IntPtr buffer = Marshal.AllocHGlobal(size);
        try { uint returned; Require(QueryInformationJobObject(job, kind, buffer, (uint)size, out returned), "Query job " + kind); return (T)Marshal.PtrToStructure(buffer, typeof(T)); }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    Dictionary<string, object> ProbeMembers(string phase) {
        var result = D("phase", phase, "queryOk", false, "accountingOk", false, "complete", false);
        int size = 8 + 8 * IntPtr.Size; IntPtr buffer = Marshal.AllocHGlobal(size);
        try {
            uint returned; bool ok = QueryInformationJobObject(job, 3, buffer, (uint)size, out returned); int error = ok ? 0 : Marshal.GetLastWin32Error();
            result["queryOk"] = ok; result["queryError"] = error;
            // On failure the output buffer/returned length is not evidence. Never parse or invent zeroes.
            if (ok) {
                result["returnedBytes"] = returned;
                if (returned >= 8 && returned <= size) {
                    uint assignedCount = (uint)Marshal.ReadInt32(buffer), listed = (uint)Marshal.ReadInt32(buffer, 4);
                    result["assigned"] = assignedCount; result["listed"] = listed;
                    if (listed <= 8 && 8 + listed * IntPtr.Size <= returned) {
                        var pids = new List<long>(); for (int i = 0; i < listed; i++) pids.Add(Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64());
                        if (pids.TrueForAll(pid => pid > 0)) result["pids"] = pids;
                    }
                }
            }
            int accountingSize = Marshal.SizeOf(typeof(Accounting)); uint accountingBytes;
            bool accountingOk = QueryInformationJobObject(job, 1, buffer, (uint)accountingSize, out accountingBytes);
            result["accountingOk"] = accountingOk; result["accountingError"] = accountingOk ? 0 : Marshal.GetLastWin32Error();
            if (accountingOk && accountingBytes == accountingSize) {
                var accounting = (Accounting)Marshal.PtrToStructure(buffer, typeof(Accounting)); result["active"] = accounting.Active; result["total"] = accounting.Total;
            }
            if (result.ContainsKey("pids") && result.ContainsKey("active")) {
                var ids = (List<long>)result["pids"];
                result["complete"] = (uint)result["assigned"] == (uint)result["listed"] && ids.Count == (uint)result["listed"] &&
                    new HashSet<long>(ids).Count == ids.Count && (uint)result["active"] == ids.Count && (uint)result["total"] >= (uint)result["active"];
            }
        } catch (Exception ex) { ObservationError("membership: " + ex.Message); result["exception"] = ex.Message.Substring(0, Math.Min(ex.Message.Length, 300)); }
        finally { Marshal.FreeHGlobal(buffer); }
        lastObservation = result; if ((bool)result["complete"]) { previousComplete = lastComplete; lastComplete = result; }
        string signature = phase + ":" + String.Join(",", result.ContainsKey("pids") ? (List<long>)result["pids"] : new List<long>()) + ":" + result["complete"] + ":" + result["queryOk"] + ":" + result["accountingOk"];
        if (signature != memberSignature) { memberSignature = signature; Note("membership", result); }
        return result;
    }
    Dictionary<string, object> Members(string phase) {
        var value = ProbeMembers(phase);
        if (!(bool)value["complete"]) { Offending(value); throw new InvalidOperationException("Incomplete job membership"); }
        return value;
    }
    void Offending(Dictionary<string, object> value) {
        if (offending == null) { lastCompleteBeforeFailure = (bool)value["complete"] ? previousComplete : lastComplete; offending = value; }
        Note("offending-membership", value);
    }
    void Own(string role, IntPtr handle) { handleInventory[role] = D("acquisition", "acquired", "disposition", "not-attempted", "handle", H(handle)); }
    void AcquisitionFailed(string role, int error) { handleInventory[role] = D("acquisition", "failed", "disposition", "not-attempted", "win32Error", error); }
    Dictionary<string, object> ObserveProcess(string role, IntPtr process) {
        var result = D("role", role, "identity", D(), "wait", D("ok", false), "exit", D("ok", false));
        if (process == IntPtr.Zero) { result["state"] = "never-acquired"; return result; }
        result["state"] = "acquired"; var identity = (Dictionary<string, object>)result["identity"];
        Step(role + " identity", delegate {
            uint pid = GetProcessId(process); if (pid != 0) identity["pid"] = pid; else ObservationError(role + " GetProcessId: " + Marshal.GetLastWin32Error());
            long creation, exit, kernel, user;
            if (GetProcessTimes(process, out creation, out exit, out kernel, out user)) identity["creationFileTime"] = creation.ToString(); else ObservationError(role + " GetProcessTimes: " + Marshal.GetLastWin32Error());
            var image = new StringBuilder(32768); uint length = (uint)image.Capacity;
            if (QueryFullProcessImageNameW(process, 0, image, ref length)) identity["image"] = image.ToString(); else ObservationError(role + " QueryImage: " + Marshal.GetLastWin32Error());
            bool member; if (IsProcessInJob(process, job, out member)) identity["member"] = member; else ObservationError(role + " IsProcessInJob: " + Marshal.GetLastWin32Error());
        });
        Step(role + " wait", delegate {
            uint wait = WaitForSingleObject(process, 0); result["wait"] = wait == UInt32.MaxValue ? D("ok", false, "win32Error", Marshal.GetLastWin32Error()) : D("ok", true, "result", wait);
            uint code; result["exit"] = GetExitCodeProcess(process, out code) ? D("ok", true, "code", code) : D("ok", false, "win32Error", Marshal.GetLastWin32Error());
        });
        ((Dictionary<string, object>)handleInventory[role])["observation"] = result; Note("handle-observation", result); return result;
    }
    bool CloseTracked(string role, IntPtr handle) {
        if (handle == IntPtr.Zero) return false; // never acquired is not a successful close
        bool closed = false; var tracking = (Dictionary<string, object>)handleInventory[role]; tracking["disposition"] = "close-failed";
        Step("close " + role, delegate { closed = CloseHandle(handle); int error = closed ? 0 : Marshal.GetLastWin32Error(); var item = (Dictionary<string, object>)handleInventory[role]; item["disposition"] = closed ? "closed" : "close-failed";
            if (!closed) item["closeError"] = error; });
        return closed;
    }
    void TerminalCapture() {
        // Bounded zero-time observations before owner disposal, even after an original failure.
        for (int attempt = 0; attempt < 8; attempt++) {
            var members = ProbeMembers("terminal"); var rootObservation = ObserveProcess("root", root.Process); var childObservation = ObserveProcess("child", child);
            terminalEvidence = D("members", members, "root", rootObservation, "child", childObservation); terminalSamples.Add(terminalEvidence);
            var rw = (Dictionary<string, object>)rootObservation["wait"]; var cw = (Dictionary<string, object>)childObservation["wait"];
            if ((bool)members["complete"] && (uint)members["active"] == 0 && rw.ContainsKey("result") && cw.ContainsKey("result") && (uint)rw["result"] == 0 && (uint)cw["result"] == 0) break;
            Thread.Sleep(10);
        }
    }
    sealed class NativeOutput {
        public IntPtr Read, Write; Thread reader;
        readonly object sync = new object(); readonly MemoryStream retained = new MemoryStream();
        long bytes, dropped; int errors; bool drained, readerDone, readerStarted; string readDisposition = "never-acquired", writeDisposition = "never-acquired";
        public void Create() {
            var sa = new SecurityAttributes(); sa.Size = (uint)Marshal.SizeOf(typeof(SecurityAttributes)); sa.Inherit = true;
            IntPtr read, write; Require(CreatePipe(out read, out write, ref sa, 4096), "Create root output pipe");
            Read = read; Write = write; readDisposition = "acquired"; writeDisposition = "acquired";
            Require(SetHandleInformation(Read, 1, 0), "Read handle must not inherit");
            uint rf, wf; Require(GetHandleInformation(Read, out rf), "Inspect pipe read inheritance"); Require(GetHandleInformation(Write, out wf), "Inspect pipe write inheritance");
            if ((rf & 1) != 0 || (wf & 1) == 0) throw new InvalidOperationException("Unexpected pipe inheritance");
            reader = new Thread(Drain); reader.IsBackground = true; reader.Start(); readerStarted = true;
        }
        void Drain() {
            try {
                var buffer = new byte[4096];
                while (true) {
                    uint read; bool ok = ReadFile(Read, buffer, (uint)buffer.Length, out read, IntPtr.Zero);
                    if (!ok) { int error = Marshal.GetLastWin32Error(); lock (sync) { if (error == 109) drained = true; else errors++; } break; }
                    if (read == 0) { Thread.Sleep(1); continue; } // successful zero-byte write is not EOF
                    lock (sync) { bytes += read; int keep = Math.Min((int)read, 65536 - (int)retained.Length); retained.Write(buffer, 0, keep); dropped += read - keep; }
                }
            } catch { lock (sync) { errors++; } }
            finally { bool closed = CloseHandle(Read); lock (sync) { readDisposition = closed ? "closed" : "close-failed"; if (!closed) errors++; readerDone = true; } }
        }
        public void CloseWrite() {
            if (Write == IntPtr.Zero) return;
            bool closed = CloseHandle(Write); lock (sync) { writeDisposition = closed ? "closed" : "close-failed"; if (!closed) errors++; }
            if (closed) Write = IntPtr.Zero;
        }
        public Dictionary<string, object> Finish() {
            CloseWrite(); if (readerStarted) try { reader.Join(100); } catch { lock (sync) { errors++; } }
            // Never close a handle under an outstanding ReadFile. Unknown drain/close refuses reuse.
            if (!readerStarted && Read != IntPtr.Zero) { bool closed = CloseHandle(Read); readDisposition = closed ? "closed" : "close-failed"; if (!closed) errors++; }
            lock (sync) { return D("bytes", bytes, "retained", retained.Length, "dropped", dropped, "errors", errors, "drained", drained,
                "closed", readerDone && readDisposition == "closed" && writeDisposition == "closed", "readDisposition", readDisposition,
                "writeDisposition", writeDisposition, "encoding", "base64", "data", Convert.ToBase64String(retained.ToArray())); }
        }
    }
    Dictionary<string, object> PrepareStandardHandles(ref StartupEx startup) {
        Require(SetHandleInformation(job, 1, 0), "Job handle must remain noninherited");
        uint jobFlags; Require(GetHandleInformation(job, out jobFlags), "Inspect job inheritance");
        if ((jobFlags & 1) != 0) throw new InvalidOperationException("Inherited job handle refused");
        stdout = new NativeOutput(); stdout.Create(); stderr = new NativeOutput(); stderr.Create();
        var sa = new SecurityAttributes(); sa.Size = (uint)Marshal.SizeOf(typeof(SecurityAttributes)); sa.Inherit = true;
        IntPtr candidate = CreateFileW("NUL", 0x80000000, 3, ref sa, 3, 0, IntPtr.Zero);
        if (candidate == IntPtr.Zero || candidate == new IntPtr(-1)) { int error = Marshal.GetLastWin32Error(); AcquisitionFailed("stdin", error); throw new Win32Exception(error, "Open explicit root stdin"); }
        input = candidate; Own("stdin", input);
        uint inputFlags; Require(GetHandleInformation(input, out inputFlags), "Inspect stdin inheritance");
        if ((inputFlags & 1) == 0) throw new InvalidOperationException("Noninheritable stdin refused");
        inheritedHandles = Marshal.AllocHGlobal(3 * IntPtr.Size);
        Marshal.WriteIntPtr(inheritedHandles, 0, input); Marshal.WriteIntPtr(inheritedHandles, IntPtr.Size, stdout.Write); Marshal.WriteIntPtr(inheritedHandles, 2 * IntPtr.Size, stderr.Write);
        Require(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x20002), inheritedHandles, new UIntPtr((uint)(3 * IntPtr.Size)), IntPtr.Zero, IntPtr.Zero), "Set exact standard handle list");
        startup.Basic.Flags |= 0x100; startup.Basic.Input = input; startup.Basic.Output = stdout.Write; startup.Basic.Error = stderr.Write;
        return D("useStdHandles", true, "inheritHandles", true, "jobInherited", false, "jobHandle", H(job), "readHandlesInherited", false, "handleList", new [] { H(input), H(stdout.Write), H(stderr.Write) });
    }
    void CloseParentWriters() {
        if (stdout != null) Step("close root stdout parent writer", stdout.CloseWrite);
        if (stderr != null) Step("close root stderr parent writer", stderr.CloseWrite);
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
        if (IntPtr.Size != 8 || Marshal.SizeOf(typeof(ExtendedLimits)) != 144 || Marshal.SizeOf(typeof(Accounting)) != 48 || Marshal.SizeOf(typeof(Startup)) != 104 || Marshal.SizeOf(typeof(StartupEx)) != 112 || Marshal.SizeOf(typeof(SecurityAttributes)) != 24)
            throw new PlatformNotSupportedException("Only verified x64 structure layout is supported");
        foreach (string name in new [] { "CreateJobObjectW", "SetInformationJobObject", "QueryInformationJobObject", "AssignProcessToJobObject", "IsProcessInJob", "TerminateJobObject", "CreateProcessW", "InitializeProcThreadAttributeList", "UpdateProcThreadAttribute", "DeleteProcThreadAttributeList", "ResumeThread", "TerminateProcess", "OpenProcess", "GetProcessId", "GetProcessTimes", "QueryFullProcessImageNameW", "GetExitCodeProcess", "WaitForSingleObject", "CloseHandle", "CreatePipe", "ReadFile", "CreateFileW", "SetHandleInformation", "GetHandleInformation" })
            if (GetProcAddress(GetModuleHandleW("kernel32.dll"), name) == IntPtr.Zero) throw new PlatformNotSupportedException("Missing export " + name);
        job = CreateJobObjectW(IntPtr.Zero, null); Require(job != IntPtr.Zero, "Create unnamed job"); Own("job", job);
        var limits = new ExtendedLimits(); limits.Basic.Flags = KillOnClose;
        Require(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "Set kill-on-close, no breakaway");
        var observed = Query<ExtendedLimits>(9);
        if (observed.Basic.Flags != KillOnClose) throw new InvalidOperationException("Unexpected owner limits");
        bool inOuter; Require(IsProcessInJob(GetCurrentProcess(), IntPtr.Zero, out inOuter), "Read helper outer job status");
        Note("owner-acquired", D("handle", H(job), "flags", observed.Basic.Flags, "helperPid", GetProcessId(GetCurrentProcess()), "helperInOuterJob", inOuter, "members", Members("owner-empty")));
        UIntPtr sizeNeeded = UIntPtr.Zero;
        bool sizing = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref sizeNeeded);
        if (sizing || Marshal.GetLastWin32Error() != 122 || sizeNeeded.ToUInt64() == 0 || sizeNeeded.ToUInt64() > 65536) throw new InvalidOperationException("Unexpected attribute sizing result");
        attributes = Marshal.AllocHGlobal((int)sizeNeeded.ToUInt64());
        Require(InitializeProcThreadAttributeList(attributes, 2, 0, ref sizeNeeded), "Initialize process attributes"); attributesInitialized = true;
        jobValue = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobValue, job);
        // ProcThreadAttributeValue(JobList=13, thread=false, input=true, additive=false), public Windows SDK.
        Require(UpdateProcThreadAttribute(attributes, 0, new UIntPtr(0x2000d), jobValue, new UIntPtr((uint)IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Set creation-time job list");
        Note("creation-owner-configured", D("attribute", "PROC_THREAD_ATTRIBUTE_JOB_LIST", "targetCreated", false));
    }
    void FreeAttributes() {
        if (attributesInitialized) { DeleteProcThreadAttributeList(attributes); attributesInitialized = false; }
        if (attributes != IntPtr.Zero) { Marshal.FreeHGlobal(attributes); attributes = IntPtr.Zero; }
        if (jobValue != IntPtr.Zero) { Marshal.FreeHGlobal(jobValue); jobValue = IntPtr.Zero; }
        if (inheritedHandles != IntPtr.Zero) { Marshal.FreeHGlobal(inheritedHandles); inheritedHandles = IntPtr.Zero; }
    }
    public static Dictionary<string, object> Preflight() {
        if (!PreflightSetupAllowed) throw new InvalidOperationException("PREFLIGHT_SETUP_HOLD");
        var owner = new FirstMateJobCapability(); string error = null; bool errorTruncated = false, attributesReleased = false, jobClosed = false;
        try {
            owner.Acquire(); var empty = owner.lastComplete;
            if (empty == null || (uint)empty["active"] != 0 || (uint)empty["listed"] != 0 || (uint)empty["total"] != 0)
                throw new InvalidOperationException("Preflight job is not empty");
        }
        catch (Exception ex) { error = ex.GetType().Name + ": " + ex.Message; errorTruncated = error.Length > 4096; if (errorTruncated) error = error.Substring(0, 4096); }
        finally {
            owner.Step("preflight attributes", delegate { owner.FreeAttributes(); attributesReleased = !owner.attributesInitialized && owner.attributes == IntPtr.Zero && owner.jobValue == IntPtr.Zero && owner.inheritedHandles == IntPtr.Zero; });
            owner.Step("preflight job close", delegate { jobClosed = owner.CloseTracked("job", owner.job); });
        }
        return D("available", error == null && attributesReleased && jobClosed && owner.recordFailures == 0 && owner.recordDropped == 0,
            "targetCreated", false, "error", error, "originalFailure", error, "originalFailureTruncated", errorTruncated, "jobClosed", jobClosed,
            "cleanup", D("attributesReleased", attributesReleased, "jobClosed", jobClosed), "handleInventory", owner.handleInventory, "events", owner.events,
            "observation", D("dropped", owner.recordDropped, "failures", owner.recordFailures, "errors", owner.observationErrors));
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
        if (!CaptureReviewAccepted) throw new InvalidOperationException("OWNER_CAPTURE_REVIEW_HOLD");
        if (scenario != "normal" && scenario != "blocked") throw new ArgumentException("Only the two named synthetic cases are permitted");
        var owner = new FirstMateJobCapability(); var receipt = D("scenario", scenario, "error", null, "originalFailure", null, "targetCreated", false, "targetResumed", false);
        Timer timer = null; bool timerDrained = true; IntPtr environment = IntPtr.Zero;
        try {
            owner.Acquire(); // includes successful creation-time job attribute before CreateProcess
            var startup = new StartupEx(); startup.Basic.Size = (uint)Marshal.SizeOf(typeof(StartupEx)); startup.Attributes = owner.attributes;
            receipt["standardWiring"] = owner.PrepareStandardHandles(ref startup);
            string systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
            if (String.IsNullOrEmpty(systemRoot)) throw new InvalidOperationException("Missing SystemRoot");
            environment = Marshal.StringToHGlobalUni("SystemRoot=" + systemRoot + "\0TEMP=" + directory + "\0TMP=" + directory + "\0\0");
            timer = new Timer(delegate { owner.deadlineFired = true; owner.Step("deadline termination", delegate { owner.Terminate("independent-parent-deadline"); }); }, null, 5000, Timeout.Infinite);
            owner.Note("deadline-armed", D("durationMs", 5000, "thread", "parent CLR timer, outside owned job"));
            ProcessInfo createdRoot;
            bool created = CreateProcessW(node, new StringBuilder(Quote(node) + " " + Quote(entry) + " " + Quote(config)), IntPtr.Zero, IntPtr.Zero,
                true, Suspended | UnicodeEnvironment | NoWindow | 0x80000, environment, directory, ref startup, out createdRoot);
            if (!created) { int error = Marshal.GetLastWin32Error(); owner.AcquisitionFailed("root", error); owner.AcquisitionFailed("thread", error); throw new Win32Exception(error, "Create suspended root assigned at creation"); }
            owner.root = createdRoot; // failed native outputs are never adopted, observed or closed
            receipt["targetCreated"] = true;
            owner.Own("root", owner.root.Process); owner.Own("thread", owner.root.Thread);
            owner.ObserveProcess("root", owner.root.Process); owner.CloseParentWriters();
            var rootIdentity = owner.Identity(owner.root.Process);
            var initial = owner.Members("before-resume");
            if (!(bool)rootIdentity["member"] || (uint)initial["active"] != 1 || (uint)initial["listed"] != 1 || ((List<long>)initial["pids"])[0] != owner.root.Pid)
                { owner.Offending(initial); throw new InvalidOperationException("Missing pre-execution root membership"); }
            receipt["root"] = rootIdentity; receipt["beforeResume"] = initial;
            owner.Note("suspended-root-owned", rootIdentity);
            if (owner.deadlineFired) throw new TimeoutException("Deadline before root resume");
            uint previous = ResumeThread(owner.root.Thread); Require(previous != UInt32.MaxValue, "Resume owned root");
            if (previous != 1) throw new InvalidOperationException("Unexpected suspend count");
            receipt["targetResumed"] = true; owner.Note("root-resumed", D("previousSuspendCount", previous));
            owner.FreeAttributes();
            Dictionary<string, object> pair = null;
            while (!owner.deadlineFired) {
                var members = owner.Members("live"); var pids = (List<long>)members["pids"];
                if (pids.Count > 2 || !pids.Contains(owner.root.Pid)) { owner.Offending(members); owner.ObserveProcess("root", owner.root.Process); owner.ObserveProcess("child", owner.child); throw new InvalidOperationException("Unexpected live owned set"); }
                if (pids.Count == 2 && File.Exists(Path.Combine(directory, "root-entry.json")) && File.Exists(Path.Combine(directory, "child-entry.json"))) {
                    long pid = pids[0] == owner.root.Pid ? pids[1] : pids[0];
                    if (pid <= 0 || pid > UInt32.MaxValue) throw new InvalidOperationException("Invalid member PID");
                    owner.child = OpenProcess(0x00100000 | 0x1000, false, (uint)pid);
                    if (owner.child == IntPtr.Zero) { int error = Marshal.GetLastWin32Error(); owner.AcquisitionFailed("child", error); throw new Win32Exception(error, "Open actual descendant member handle"); }
                    owner.Own("child", owner.child); owner.ObserveProcess("child", owner.child);
                    var childIdentity = owner.Identity(owner.child);
                    if (!(bool)childIdentity["member"] || (uint)childIdentity["pid"] != pid || WaitForSingleObject(owner.child, 0) != 258 || WaitForSingleObject(owner.root.Process, 0) != 258)
                        throw new InvalidOperationException("Unbound or nonlive owned handles");
                    pair = owner.Members("pair");
                    if ((uint)pair["active"] != 2 || (uint)pair["listed"] != 2 || (uint)pair["total"] != 2) { owner.Offending(pair); throw new InvalidOperationException("Incomplete pair membership/accounting"); }
                    receipt["child"] = childIdentity; receipt["liveMembers"] = pair;
                    owner.Note("root-and-descendant-bound", D("root", rootIdentity, "child", childIdentity, "members", pair)); break;
                }
                Thread.Sleep(10);
            }
            if (pair == null) throw new TimeoutException("No confirmed root/descendant pair before deadline");
            if (scenario == "normal") { File.WriteAllText(Path.Combine(directory, "release"), "owned-pair-confirmed"); owner.Note("normal-release", D("membersConfirmed", true)); }
            double closeLimit = owner.clock.Elapsed.TotalMilliseconds + 8000;
            while (owner.clock.Elapsed.TotalMilliseconds < closeLimit) {
                var members = owner.Members("success-terminal");
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
            receipt["originalFailure"] = receipt["error"];
            if (owner.job != IntPtr.Zero && (bool)receipt["targetCreated"]) owner.Step("failed-prerequisite termination", delegate { owner.Terminate("failed-prerequisite-cleanup"); });
        } finally {
            if (timer != null) { timerDrained = false; owner.Step("timer disposal", delegate { using (var drained = new ManualResetEvent(false)) { timer.Dispose(drained); timerDrained = drained.WaitOne(1000); } }); }
            if (owner.job != IntPtr.Zero) owner.Step("terminal capture", owner.TerminalCapture);
            owner.CloseParentWriters();
            var outputs = D();
            if (owner.stdout != null) owner.Step("root stdout drain", delegate { outputs["stdout"] = owner.stdout.Finish(); });
            if (owner.stderr != null) owner.Step("root stderr drain", delegate { outputs["stderr"] = owner.stderr.Finish(); }); receipt["rootOutput"] = outputs;
            owner.Step("attribute disposal", owner.FreeAttributes); if (environment != IntPtr.Zero) owner.Step("environment disposal", delegate { Marshal.FreeHGlobal(environment); });
            // A failed receipt never permits reuse. Closing this noninherited job handle retains kill-on-close protection.
            bool threadClosed = owner.CloseTracked("thread", owner.root.Thread);
            bool childClosed = owner.CloseTracked("child", owner.child);
            bool rootClosed = owner.CloseTracked("root", owner.root.Process);
            bool jobClosed = timerDrained && owner.CloseTracked("job", owner.job);
            bool inputClosed = owner.CloseTracked("stdin", owner.input); receipt["stdinClosed"] = inputClosed;
            receipt["cleanup"] = D("timerDrained", timerDrained, "threadHandleClosed", threadClosed, "childHandleClosed", childClosed, "rootHandleClosed", rootClosed, "jobHandleClosed", jobClosed);
        }
        receipt["deadlineFired"] = owner.deadlineFired; receipt["terminateRequested"] = owner.terminateRequested;
        receipt["terminateReturned"] = owner.terminateReturned; receipt["terminationError"] = owner.terminationError; receipt["terminationAtMs"] = owner.terminationAt;
        receipt["events"] = owner.events;
        receipt["captureVersion"] = 2; receipt["handleInventory"] = owner.handleInventory; receipt["terminalEvidence"] = owner.terminalEvidence;
        receipt["membershipEvidence"] = D("lastComplete", owner.lastComplete, "lastCompleteBeforeFailure", owner.lastCompleteBeforeFailure, "lastObservation", owner.lastObservation, "offending", owner.offending, "terminalSamples", owner.terminalSamples);
        receipt["observation"] = D("dropped", owner.recordDropped, "failures", owner.recordFailures, "errors", owner.observationErrors);
        return receipt;
    }
    static readonly bool PreflightSetupAllowed = true; // setup/disposal only; Run remains independently held
    static readonly bool CaptureReviewAccepted = false; // no override; source review, prior C2 resolution and fresh dispatch are prerequisites
}
