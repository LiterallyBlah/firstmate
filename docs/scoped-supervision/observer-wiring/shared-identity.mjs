/** A single child-only bridge shared by the original process module and child main. */
import { openSelectedCase } from './client.mjs';
const cases = new Map();
export function sharedIdentityCase(capsulePath) {
  if (!cases.has(capsulePath)) cases.set(capsulePath, openSelectedCase(capsulePath));
  return cases.get(capsulePath);
}
