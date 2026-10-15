import { expect, it } from "vitest";
import { browserAddress } from "./native-tools";

it("accepts absolute HTTP(S) URLs including localhost, ports and fragments", () => {
  expect(browserAddress(" https://example.com/docs?q=hello#part ")).toBe("https://example.com/docs?q=hello#part");
  expect(browserAddress("http://localhost:3000")).toBe("http://localhost:3000/");
  expect(browserAddress("http://[::1]:8080/")).toBe("http://[::1]:8080/");
});

it("refuses empty, relative, script, file and other non-web addresses", () => {
  for (const value of [
    "",
    " ",
    "/file",
    "example.com",
    "localhost:3000",
    "javascript:alert(1)",
    "file:///tmp/a",
    "data:text/html,a",
    "https://",
    "https://[",
    "ftp://example.com",
  ]) {
    expect(browserAddress(value), value).toBeNull();
  }
});
