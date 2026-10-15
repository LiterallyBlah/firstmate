import { describe, expect, it } from "vitest";
import type { Fleet } from "../shared/fleet";
import { chatIsVisible, homeWorkspace } from "./shell";

describe("the home workspace is never inferred from an unrelated agent", () => {
  it("requires the configured mate to be in the home and have a workspace", () => {
    const fleet = (mateInHome: boolean, workspaceId: string | null) => ({ mateInHome, mate: { workspaceId } }) as Fleet;
    expect(homeWorkspace(null)).toBeNull();
    expect(homeWorkspace({ mateInHome: false, mate: null } as Fleet)).toBeNull();
    expect(homeWorkspace(fleet(false, "other-project"))).toBeNull();
    expect(homeWorkspace(fleet(true, null))).toBeNull();
    expect(homeWorkspace(fleet(true, "home"))).toBe("home");
  });
});

it("only a visible first-mate chat can clear attention", () => {
  for (const view of ["deck", "board", "crew"] as const) {
    expect(chatIsVisible(view, false, "chat", false)).toBe(false);
    expect(chatIsVisible(view, true, "chat", false)).toBe(false);
  }
  expect(chatIsVisible("home", false, "chat", false)).toBe(true);
  expect(chatIsVisible("home", false, "chat", true)).toBe(false);
  expect(chatIsVisible("home", true, "board", false)).toBe(false);
  expect(chatIsVisible("home", true, "files", false)).toBe(false);
  expect(chatIsVisible("home", true, "chat", true)).toBe(true);
});
