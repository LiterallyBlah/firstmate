/** Authoring overlay for the selected pack. Same SETTING / ?setting= options as render.mjs. */
process.env.OVERLAY = "1";
await import("./render.mjs");
