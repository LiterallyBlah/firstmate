/** Current attention-carrier acceptance; earlier worker-focus evidence is historical. */
import { checkSharkSuggestions } from '../deck-shark-suggestions/check.mjs';
export async function checkAttention(view, manifest) {
  await checkSharkSuggestions(view, manifest, 'after');
}
