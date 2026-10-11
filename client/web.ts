/**
 * Every browser global this plugin touches, in the one module the plugin API
 * allows them in. Each export declares the narrow shape of the globals it
 * uses, gates on `Platform.OS`, and gives native the alternative or a no-op —
 * so the rest of `client/` never reaches for `window` or `document` and
 * typechecks without the DOM library.
 *
 * The exports are the chat pane's resize drag, copied from
 * `github-board/client/web.ts` — there is no workspace root to share it from —
 * and the chat's file picker, paste and drop.
 */
import { Platform } from "react-native";
import { rasterImageType } from "../shared/attachments";

/** Browser attributes omitted by React Native Web. Native keeps its own accessibility props. */
export function webAttributes(attributes: Record<string, string | null>, cursor?: string): { ref?: (node: unknown) => void } {
  if (Platform.OS !== "web") return {};
  return {
    ref: (node) => {
      if (typeof node !== "object" || node === null) return;
      const setAttribute: unknown = Reflect.get(node, "setAttribute");
      const removeAttribute: unknown = Reflect.get(node, "removeAttribute");
      if (typeof setAttribute === "function") {
        for (const [key, value] of Object.entries(attributes)) {
          if (value === null) {
            if (typeof removeAttribute === "function") removeAttribute.call(node, key);
          } else setAttribute.call(node, key, value);
        }
      }
      const style: unknown = Reflect.get(node, "style");
      if (cursor !== undefined && typeof style === "object" && style !== null) Reflect.set(style, "cursor", cursor);
    },
  };
}

/** Escape can expose another control beneath a popup without any pointer movement. */
export function fromHiddenTooltip(event: unknown): boolean {
  if (Platform.OS !== "web" || typeof event !== "object" || event === null) return false;
  const source: unknown = Reflect.get(event, "target");
  if (typeof source !== "object" || source === null) return false;
  const closest: unknown = Reflect.get(source, "closest");
  if (typeof closest !== "function") return false;
  const tooltip: unknown = closest.call(source, '[role="tooltip"]');
  if (typeof tooltip !== "object" || tooltip === null) return false;
  const style: unknown = Reflect.get(tooltip, "style");
  return typeof style === "object" && style !== null && Reflect.get(style, "display") === "none";
}

/** Disabling a focused RN Web button can suppress its component's blur event. */
export function hasWebFocus(node: unknown): boolean {
  if (Platform.OS !== "web" || typeof node !== "object" || node === null) return false;
  const contains: unknown = Reflect.get(node, "contains");
  const active = (globalThis as { document?: { activeElement?: unknown } }).document?.activeElement;
  return active !== undefined && typeof contains === "function" && contains.call(node, active) === true;
}

/** Keep inline help inside the viewport and any pane that clips its contents. */
export function tooltipPlacement(
  trigger: unknown,
  popup: unknown,
  align: "start" | "end",
  side: "top" | "bottom",
): { left: number; side: "top" | "bottom"; maxWidth: number } | null {
  if (Platform.OS !== "web") return null;
  interface Element {
    offsetWidth: number;
    parentElement: Element | null;
    getBoundingClientRect(): {
      left: number;
      right: number;
      top: number;
      bottom: number;
      width: number;
      height: number;
    };
  }
  const web = globalThis as {
    innerWidth?: number;
    innerHeight?: number;
    getComputedStyle?: (node: Element) => {
      overflowX: string;
      overflowY: string;
    };
  };
  if (
    !web.getComputedStyle ||
    typeof trigger !== "object" ||
    trigger === null ||
    typeof popup !== "object" ||
    popup === null
  )
    return null;
  const anchor = trigger as Element,
    tip = popup as Element;
  if (
    typeof anchor.getBoundingClientRect !== "function" ||
    typeof tip.getBoundingClientRect !== "function"
  )
    return null;
  const a = anchor.getBoundingClientRect(),
    b = tip.getBoundingClientRect();
  let left = 2,
    right = (web.innerWidth ?? Infinity) - 2,
    top = 0,
    bottom = web.innerHeight ?? Infinity;
  for (
    let parent = anchor.parentElement;
    parent !== null;
    parent = parent.parentElement
  ) {
    const style = web.getComputedStyle(parent),
      bounds = parent.getBoundingClientRect();
    // A wide containing row also bounds help, so it cannot spill into an adjacent pane.
    if (bounds.width >= b.width || /^(hidden|clip|scroll|auto)$/.test(style.overflowX)) {
      left = Math.max(left, bounds.left + 2);
      right = Math.min(right, bounds.right - 2);
    }
    if (/^(hidden|clip|scroll|auto)$/.test(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  const scale = anchor.offsetWidth > 0 ? a.width / anchor.offsetWidth : 1;
  const x = Math.max(
    left,
    Math.min(align === "end" ? a.right - b.width : a.left, right - b.width),
  );
  const placedSide =
    side === "top" && a.top - b.height < top && a.bottom + b.height <= bottom
      ? "bottom"
      : side === "bottom" &&
          a.bottom + b.height > bottom &&
          a.top - b.height >= top
        ? "top"
        : side;
  return {
    left: (x - a.left) / scale,
    side: placedSide,
    maxWidth: Math.max(1, right - left) / scale,
  };
}

/** Keep DOM keyboard listeners at the web boundary and remove them on unmount. */
export function bindWebKeys(target: unknown, onKey: (key: string, shift: boolean) => boolean, capture = false): () => void {
  // A hover tooltip needs Escape even while keyboard focus is elsewhere.
  target ??= (globalThis as WebGlobals).document;
  if (Platform.OS !== "web" || typeof target !== "object" || target === null) return () => {};
  const add: unknown = Reflect.get(target, "addEventListener");
  const remove: unknown = Reflect.get(target, "removeEventListener");
  if (typeof add !== "function" || typeof remove !== "function") return () => {};
  const listener = (event: { key: string; shiftKey: boolean; preventDefault(): void }) => {
    if (onKey(event.key, event.shiftKey)) event.preventDefault();
  };
  add.call(target, "keydown", listener, capture);
  return () => remove.call(target, "keydown", listener, capture);
}

/** Convert the responder's page coordinate to the document tracker's client coordinate. */
export function pointerClientX(pageX: number): number {
  return Platform.OS === "web" ? pageX - ((globalThis as { scrollX?: number }).scrollX ?? 0) : pageX;
}

/** The split's rendered width, including CSS UI scaling. Native uses onLayout's points. */
export function renderedWidth(handle: unknown, fallback: number): number {
  if (Platform.OS !== "web" || typeof handle !== "object" || handle === null) return fallback;
  const parent: unknown = Reflect.get(handle, "parentElement");
  if (typeof parent !== "object" || parent === null) return fallback;
  const bounds: unknown = Reflect.get(parent, "getBoundingClientRect");
  if (typeof bounds !== "function") return fallback;
  const rect: unknown = bounds.call(parent);
  const width: unknown = typeof rect === "object" && rect !== null ? Reflect.get(rect, "width") : null;
  return typeof width === "number" && width > 0 ? width : fallback;
}

/** Native reads the full accessibility label; browsers also offer a title tooltip. */
export function webTitle(title: string): { ref?: (node: unknown) => void } {
  if (Platform.OS !== "web") return {};
  // React Native Web filters `title` out of its props; its forwarded ref is
  // the DOM element. Keep this browser-only attribute behind the web boundary.
  return {
    ref: (node: unknown) => {
      if (typeof node !== "object" || node === null) return;
      const setAttribute: unknown = Reflect.get(node, "setAttribute");
      if (typeof setAttribute === "function") setAttribute.call(node, "title", title);
    },
  };
}

/** Private Paseo 0.11 storage adapter, deliberately kept out of components.
 * Undefined means native; null means inaccessible/missing browser storage. */
export function savedDaemonRegistry(): string | null | undefined {
  if (Platform.OS !== "web") return undefined;
  try {
    const web = globalThis as {
      localStorage?: { getItem(key: string): string | null };
    };
    return web.localStorage?.getItem("@paseo:daemon-registry") ?? null;
  } catch {
    return null;
  }
}

/** This private copy was configured for independent operation. Enable Paseo's
 * own background setting once through its desktop IPC, without restarting.
 * The marker means a later deliberate change by the captain is respected. */
export async function configureIndependentDaemon(serverId: string): Promise<void> {
  if (Platform.OS !== "web") return;
  const web = globalThis as {
    localStorage?: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    };
    paseoDesktop?: {
      invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
    };
  };
  const invoke = web.paseoDesktop?.invoke;
  if (!invoke || !web.localStorage) return;
  const marker = `firstmate:independent-daemon-configured:v1:${serverId}`;
  if (web.localStorage.getItem(marker) === "1") return;
  const status = await invoke("desktop_daemon_status");
  // A desktop connected to a remote installation must not alter its own
  // unrelated built-in daemon settings.
  if (typeof status !== "object" || status === null || Reflect.get(status, "serverId") !== serverId) return;
  const settings = await invoke("patch_desktop_settings", {
    daemon: { keepRunningAfterQuit: true },
  });
  if (typeof settings !== "object" || settings === null) throw new Error("Desktop settings unavailable");
  const daemon: unknown = Reflect.get(settings, "daemon");
  if (typeof daemon !== "object" || daemon === null || Reflect.get(daemon, "keepRunningAfterQuit") !== true)
    throw new Error("Background daemon setting unavailable");
  web.localStorage.setItem(marker, "1");
}

/** Only what this module reads off the web globals; the DOM library stays off. */
interface WebGlobals {
  document?: {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
    body?: { style?: Record<string, string> };
  };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Follows a drag at the document level on the web renderer, where the
 * responder system alone is not enough: widening the chat means dragging
 * *right*, across the board's columns, whose scroll views ask for the responder
 * as the pointer crosses them, and a pointer moving faster than the handle
 * leaves it altogether. Document listeners see every move until the button is
 * released, wherever the pointer is — including outside the window, where a
 * `blur` stands in for the release the browser cannot report.
 *
 * Native has no pointer to follow at the document level and gets a no-op; the
 * responder system alone is enough there, because there are no columns
 * competing for a finger that is already down on the handle.
 */
export function trackPointerOnDocument(onMove: (clientX: number) => void, onEnd: () => void): () => void {
  if (Platform.OS !== "web") return () => {};

  const web = globalThis as WebGlobals;
  const document = web.document;
  if (
    document === undefined ||
    typeof document.addEventListener !== "function" ||
    typeof document.removeEventListener !== "function"
  ) {
    return () => {};
  }
  const move = (event: unknown) => {
    const clientX = typeof event === "object" && event !== null ? Reflect.get(event, "clientX") : null;
    if (typeof clientX === "number") onMove(clientX);
  };
  /**
   * A drag is also a mouse-down followed by movement, which is how a browser
   * starts a text selection — and once the pointer leaves the handle, every
   * card title it crosses is selectable. Selection is switched off on the body
   * for the drag's duration, and the resize cursor is pinned there too so it
   * does not flicker back to an I-beam over text.
   */
  const bodyStyle = document.body?.style;
  const previous = {
    userSelect: bodyStyle?.userSelect ?? "",
    webkitUserSelect: bodyStyle?.webkitUserSelect ?? "",
    cursor: bodyStyle?.cursor ?? "",
  };
  if (bodyStyle !== undefined) {
    bodyStyle.userSelect = "none";
    bodyStyle.webkitUserSelect = "none";
    bodyStyle.cursor = "col-resize";
  }
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    if (bodyStyle !== undefined) {
      bodyStyle.userSelect = previous.userSelect;
      bodyStyle.webkitUserSelect = previous.webkitUserSelect;
      bodyStyle.cursor = previous.cursor;
    }
    document.removeEventListener?.("pointermove", move);
    document.removeEventListener?.("pointerup", end);
    document.removeEventListener?.("pointercancel", end);
    web.removeEventListener?.("blur", end);
    onEnd();
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  web.addEventListener?.("blur", end);
  return end;
}

/** A browser `File`, as far as attaching one needs it. */
interface WebFile {
  name: string;
  type: string;
  size: number;
}

interface WebFileReader {
  result: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsDataURL(file: WebFile): void;
}

interface WebFileList {
  length: number;
  [index: number]: WebFile;
}

interface WebInputElement {
  type: string;
  multiple: boolean;
  files: WebFileList | null;
  style: Record<string, string>;
  addEventListener(type: string, listener: () => void): void;
  click(): void;
  remove(): void;
}

interface WebTransfer {
  files?: WebFileList;
  types?: ArrayLike<string>;
  dropEffect?: string;
}

interface WebTransferEvent {
  clipboardData?: WebTransfer | null;
  dataTransfer?: WebTransfer | null;
  preventDefault(): void;
}

interface WebEventTarget {
  addEventListener(type: string, listener: (event: WebTransferEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebTransferEvent) => void): void;
}

interface FileGlobals {
  document?: {
    createElement?: (tag: string) => WebInputElement;
    body?: { appendChild?: (node: WebInputElement) => void };
  };
  FileReader?: new () => WebFileReader;
}

/** A file the browser handed over, before its bytes are read. */
export interface OfferedFile {
  fileName: string;
  mimeType: string;
  size: number;
  /** Its bytes, as base64 without the `data:` prefix. */
  read(): Promise<string>;
}

/** Whether this renderer can pick, paste and drop files: the web renderer, on a desktop or in a browser. */
export const canAttachFiles = Platform.OS === "web";

function offered(file: WebFile): OfferedFile {
  return {
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    read: function read(): Promise<string> {
      return new Promise((resolve, reject) => {
        const Reader = (globalThis as unknown as FileGlobals).FileReader;
        if (Reader === undefined) {
          reject(new Error("This browser cannot read files."));
          return;
        }
        const reader = new Reader();
        reader.onload = () => {
          const url = typeof reader.result === "string" ? reader.result : "";
          const comma = url.indexOf(",");
          resolve(comma < 0 ? "" : url.slice(comma + 1));
        };
        reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
        reader.readAsDataURL(file);
      });
    },
  };
}

function listFiles(list: WebFileList | null | undefined): OfferedFile[] {
  const files: OfferedFile[] = [];
  for (let index = 0; index < (list?.length ?? 0); index += 1) {
    const file = list?.[index];
    if (file !== undefined) files.push(offered(file));
  }
  return files;
}

/**
 * Opens the browser's file picker, the one Paseo's own composer opens on the
 * web: any file, several at once. On a phone's browser it offers the photo
 * library and the camera as well as files. Resolves with nothing when the
 * captain cancels. Native has no picker a plugin can reach — Paseo's app uses
 * Expo's pickers, which are not among the host's modules — and resolves empty.
 */
export function pickFiles(): Promise<OfferedFile[]> {
  const document = (globalThis as unknown as FileGlobals).document;
  if (!canAttachFiles || typeof document?.createElement !== "function") return Promise.resolve([]);
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.style.display = "none";
  return new Promise((resolve) => {
    let settled = false;
    const finish = (files: OfferedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(listFiles(input.files)));
    input.addEventListener("cancel", () => finish([]));
    document.body?.appendChild?.(input);
    input.click();
  });
}

function carriesFiles(transfer: WebTransfer | null | undefined): boolean {
  return Array.from(transfer?.types ?? []).includes("Files");
}

/**
 * Takes images pasted into, and files dropped on, `target` — a view's element
 * on the web renderer — and reports whether a drag carrying files is over it.
 * A paste or a drop with nothing of the kind is left alone, so pasting text
 * still pastes text.
 * Native gets a no-op: nothing is dragged there, and the host's `TextInput`
 * does not hand a plugin pasted images.
 */
export function receiveFiles(
  target: unknown,
  onFiles: (files: OfferedFile[]) => void,
  onDragging: (dragging: boolean) => void,
): () => void {
  if (!canAttachFiles || typeof target !== "object" || target === null) return () => {};
  const element = target as Partial<WebEventTarget>;
  if (typeof element.addEventListener !== "function" || typeof element.removeEventListener !== "function") {
    return () => {};
  }
  /** Enter and leave fire for every child crossed; the drag is over only when they balance. */
  let depth = 0;
  // Images only, as Paseo's composer pastes: a copied file or a rich clipboard is left to the text box.
  const paste = (event: WebTransferEvent) => {
    const files = listFiles(event.clipboardData?.files).filter(
      (file) => rasterImageType(file.mimeType, file.fileName) !== null,
    );
    if (files.length === 0) return;
    event.preventDefault();
    onFiles(files);
  };
  const enter = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth += 1;
    if (depth === 1) onDragging(true);
  };
  const over = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    // Without this the browser — or Electron — opens the file instead of dropping it here.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const leave = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) onDragging(false);
  };
  const drop = (event: WebTransferEvent) => {
    if (!carriesFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth = 0;
    onDragging(false);
    const files = listFiles(event.dataTransfer?.files);
    if (files.length > 0) onFiles(files);
  };
  const listeners: Array<[string, (event: WebTransferEvent) => void]> = [
    ["paste", paste],
    ["dragenter", enter],
    ["dragover", over],
    ["dragleave", leave],
    ["drop", drop],
  ];
  listeners.forEach(([type, listener]) => element.addEventListener?.(type, listener));
  return () => listeners.forEach(([type, listener]) => element.removeEventListener?.(type, listener));
}
