// Fails the build when the generated chunks import each other in a cycle.
// A cycle between chunks can leave a module undefined at startup (1.8.0
// shipped a blank page because the react and data vendor chunks did).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), 'dist', 'assets');
const chunks = readdirSync(dir).filter((f) => f.endsWith('.js'));

// Static imports only: `import ... from "./x.js"` / `import "./x.js"`.
// Dynamic import() chunks load later and cannot deadlock startup.
const staticImport = /(?:import|export)\s*(?:[\w*{}\s,$]+from\s*)?["']\.\/([^"']+\.js)["']/g;

const graph = new Map();
for (const file of chunks) {
  const code = readFileSync(join(dir, file), 'utf8');
  graph.set(file, [...new Set([...code.matchAll(staticImport)].map((m) => m[1]))]);
}

const cycles = [];
const state = new Map(); // 1 = visiting, 2 = done
const stack = [];
function visit(node) {
  state.set(node, 1);
  stack.push(node);
  for (const next of graph.get(node) ?? []) {
    if (state.get(next) === 1) cycles.push([...stack.slice(stack.indexOf(next)), next].join(' -> '));
    else if (!state.get(next)) visit(next);
  }
  stack.pop();
  state.set(node, 2);
}
for (const node of graph.keys()) if (!state.get(node)) visit(node);

if (cycles.length > 0) {
  console.error('Circular imports between chunks:\n  ' + cycles.join('\n  '));
  process.exit(1);
}
console.log(`Chunk graph OK (${chunks.length} chunks, no static cycles)`);
