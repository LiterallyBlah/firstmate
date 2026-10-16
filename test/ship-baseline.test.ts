import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import { SHIP_PACK, shipFile, shipManifest } from "./ship-pack";

describe("the frozen Ship engine baseline", () => {
  it("retains every recorded source blob, including the exact manifest", () => {
    const record = JSON.parse(readFileSync(new URL("./fixtures/ship-baseline.json", import.meta.url), "utf8")) as { revision: string; files: Record<string, string> };
    expect(record.revision).toBe("890348a83c2d87a2e58f114892b0e2e9d89b7896");
    expect(record.files["setting.json"]).toBe("6ccbee8ccffe72008312f0729689e257005f57d0da7e28dca5e34081ddf145fb");
    expect(Object.keys(record.files).sort()).toEqual(["setting.json", ...Object.values(shipManifest().images).map(image => image.path)].sort());
    for (const [path, hash] of Object.entries(record.files)) expect(createHash("sha256").update(readFileSync(shipFile(path))).digest("hex"), path).toBe(hash);
  });
  it("is outside installed pack discovery and package delivery", () => {
    expect(SHIP_PACK).not.toContain("art/settings");
    const root = fileURLToPath(new URL("../", import.meta.url));
    expect(readdirSync(root + "/art/settings")).not.toContain("ship-baseline");
    const pkg = JSON.parse(readFileSync(root + "/package.json", "utf8")) as { files: string[] };
    expect(pkg.files).not.toContain("test/");
  });
});
