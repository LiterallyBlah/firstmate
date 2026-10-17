import { createScenery } from "../../client/deck-environment";
import { compileAmbience } from "../../client/deck-ambience";
import { compileAtmosphere } from "../../client/deck-atmosphere";

window.benchRain = async function ({ manifest, images, mode, width, height, seed = 123 }) {
  const decoded = new Map(await Promise.all(Object.entries(images).map(async ([id, base64]) => {
    const image = new Image(); image.src = "data:image/png;base64," + base64; await image.decode(); return [id, image];
  })));
  const app = new PIXI.Application();
  await app.init({ width, height, preference: "webgl", resolution: 1, background: "#142831", antialias: false, roundPixels: true, autoStart: false });
  document.body.replaceChildren(app.canvas);
  const scenery = createScenery(PIXI, { width: manifest.stage.size[0], height: manifest.stage.size[1] }, {
    ambience: compileAmbience(manifest, (id) => decoded.has(id)), atmosphere: compileAtmosphere(manifest), images: decoded, masks: new Map(),
  }, seed);
  app.stage.addChild(scenery.back, scenery.front);
  const scale = 4;
  app.stage.scale.set(scale);
  app.stage.position.set(width / 2, height / 2);
  scenery.layout({ left: -width / scale / 2, right: width / scale / 2, top: -height / scale / 2, bottom: height / scale / 2 }, { width, height });
  const plan = { level: mode, animate: mode !== "still", fps: mode === "full" ? 30 : 12, ambient: mode === "full" };
  const clocks = Object.keys(manifest.atmosphere?.clocks ?? {});
  const samples = [], submit = [];
  const pixel = new Uint8Array(4);
  // Three batches interleaved by the Node driver; 30 warmup and 60 measured frames per batch.
  for (let frame = 0; frame < 90; frame++) {
    const seconds = frame / 30;
    const weather = { clocks: Object.fromEntries(clocks.map((clock) => [clock, seconds])), channels: {}, intensity: mode === "still" ? null : 1 };
    const start = performance.now();
    scenery.draw(seconds, plan, 720, weather);
    app.render();
    const submitted = performance.now();
    // Include GPU completion, not merely the CPU's command submission time.
    app.renderer.gl.readPixels(0, 0, 1, 1, app.renderer.gl.RGBA, app.renderer.gl.UNSIGNED_BYTE, pixel);
    const finish = performance.now();
    if (frame >= 30) { samples.push(finish - start); submit.push(submitted - start); }
    if (frame % 30 === 0) await new Promise((done) => setTimeout(done, 0));
  }
  const info = app.renderer.gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info ? app.renderer.gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
  const count = (node) => (node.label?.includes(":drop:") ? 1 : 0) + (node.children ?? []).reduce((sum, child) => sum + count(child), 0);
  const particles = count(app.stage);
  scenery.destroy(); app.destroy({ removeView: true }, { children: true });
  return { samples, submit, renderer, particles };
};
