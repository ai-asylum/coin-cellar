// Step tracker — logs every cooking action (tool, verb, in → out) so a
// plated dish carries its full recipe lineage, infinite-kitchen style.
let _steps = [];
let _stepId = 0;

export function resetSteps() {
  _steps = [];
  _stepId = 0;
}

export function recordStep({ toolSlug, verb, inputs, outputs }) {
  _steps.push({
    id: ++_stepId,
    tool: toolSlug,
    verb,
    in: inputs.map((i) => ({ slug: i.slug, name: i.name, states: [...i.states] })),
    out: outputs.map((o) => ({ slug: o.slug, name: o.name, states: [...(o.states || [])] })),
    at: Date.now(),
  });
}

// Recipe steps in infinite-kitchen's RecipeStep shape ({toolName, actionVerb,
// inputs, outputs}) so serve-dish accepts them as-is. Each kitchen session is
// one dish's story — the board is cleared on plate — so the whole session log
// is the recipe.
export function collectSteps() {
  return _steps.map((s) => ({
    toolName: s.tool,
    actionVerb: s.verb,
    inputs: s.in.map((i) => i.name),
    outputs: s.out.length ? s.out.map((o) => o.name) : s.in.map((i) => i.name),
  }));
}

export function stepCount() {
  return _steps.length;
}
