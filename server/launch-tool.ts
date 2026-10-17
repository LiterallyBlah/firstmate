/** Render dependency-free home code; never serialize the daemon's environment or credentials. */
import { CREW_LABELS } from "../shared/fleet";
import { homeCliLaunch } from "./cli";
import { paseoHome } from "./data-dir";
import { fill, readTemplate, TEMPLATES, withoutNotes } from "./templates";

export async function briefParts() {
  const [intro, rules, status, template] = await Promise.all([
    TEMPLATES.briefIntro, TEMPLATES.briefRules, TEMPLATES.briefStatus, TEMPLATES.briefTemplate,
  ].map(async path => withoutNotes(await readTemplate(path))));
  return { intro: intro!, rules: rules!, status: status!, template: template! };
}

export async function renderLaunchTool(home: string): Promise<string> {
  return fill(await readTemplate(TEMPLATES.launchHelper), {
    launchConfigJson: JSON.stringify({ home, paseoHome: paseoHome(), cli: await homeCliLaunch(), labels: CREW_LABELS, parts: await briefParts() }),
  });
}
