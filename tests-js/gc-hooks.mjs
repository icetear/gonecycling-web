// Node resolution hook: maps the import map specifiers "gc/x" to the real
// source files (static/js/x.js) — so that Node tests can also load the browser glue
// modules (backup.js, stores …). In the browser the <importmap>
// in templates/index.html handles this; in Node there is no import map, hence this hook.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("gc/")) {
    const url = new URL("../static/js/" + specifier.slice(3) + ".js", import.meta.url).href;
    return { url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
