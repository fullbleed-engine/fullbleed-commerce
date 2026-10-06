// SPDX-License-Identifier: MIT
// GrapesJS's published bundle embeds Backbone, Underscore and CodeMirror. Build
// its original sources (included in the locked npm source map) so WordPress can
// supply those libraries through its normal script dependency graph instead.
import { readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import ts from 'typescript';

export async function wordpressEditorPlugin() {
  const pkg = JSON.parse(await readFile('node_modules/grapesjs/package.json', 'utf8'));
  if (pkg.version !== '0.23.6') throw new Error('Review the WordPress editor adapter before upgrading GrapesJS.');
  const map = JSON.parse(await readFile('node_modules/grapesjs/dist/grapes.mjs.map', 'utf8'));
  const prefix = 'webpack://grapesjs/./src/';
  const sources = new Map(map.sources.flatMap((name, index) => name.startsWith(prefix) ? [[name.slice(prefix.length), map.sourcesContent[index]]] : []));
  // Webpack omits this re-export-only barrel from the source map. These are
  // the exact exports from packages/core/src/abstract/index.ts in upstream
  // commit 2bdeda85b82b8b9ceae42fd6558cbbcae5ec2d21 (the npm release gitHead).
  sources.set('abstract/index.ts', ['ModuleModel', 'ModuleCollection', 'ModuleView', 'Module'].map(name => `export { default as ${name} } from './${name}';`).join('\n'));
  if (!sources.has('index.ts') || [...sources.values()].some(content => typeof content !== 'string')) throw new Error('GrapesJS source map is incomplete.');
  // The shared editor supplies local icons. Remove the upstream CDN fallback
  // from the distributed WordPress bundle as well, so it cannot request it.
  const configPath = 'editor/config/config.ts';
  const iconDefault = /cssIcons: 'https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome\/4\.7\.0\/css\/font-awesome\.min\.css',/g;
  if ([...sources.get(configPath).matchAll(iconDefault)].length !== 1) throw new Error('Review the upstream editor icon default before building.');
  sources.set(configPath, sources.get(configPath).replace(iconDefault, "cssIcons: '',"));
  const globals = {
    // The local namespace receives GrapesJS's Cash and UndoManager assignments.
    // Only its View subclass uses Cash. Core Backbone's View closes over the
    // global jQuery adapter; overriding this hook keeps other plugins intact.
    backbone: `const local = { ...window.Backbone };
      local.View = window.Backbone.View.extend({
        _setElement(element) { this.$el = local.$(element); this.el = this.$el[0]; }
      });
      module.exports = local;`,
    underscore: 'module.exports = window._;',
    'codemirror/lib/codemirror': 'module.exports = window.wp.CodeMirror;',
    // These modes already ship inside the WordPress wp-codemirror handle.
    'codemirror/mode/htmlmixed/htmlmixed': 'if (!window.wp.CodeMirror.modes.htmlmixed) throw new Error("WordPress HTML editor mode is unavailable.");',
    'codemirror/mode/css/css': 'if (!window.wp.CodeMirror.modes.css) throw new Error("WordPress CSS editor mode is unavailable.");',
  };
  return {
    name: 'fullbleed-wordpress-editor',
    setup(build) {
      build.initialOptions.define = { ...build.initialOptions.define, __GJS_VERSION__: JSON.stringify(pkg.version) };
      build.onResolve({ filter: /^grapesjs$/ }, () => ({ path: 'index.ts', namespace: 'grapesjs-source' }));
      build.onResolve({ filter: /^(backbone$|underscore$|codemirror\/)/ }, ({ path }) => {
        if (!Object.hasOwn(globals, path)) throw new Error(`Review additional WordPress core dependency: ${path}`);
        return { path, namespace: 'wordpress-core' };
      });
      build.onResolve({ filter: /^\./, namespace: 'grapesjs-source' }, ({ path, importer }) => {
        const relative = posix.normalize(posix.join(posix.dirname(importer), path));
        const found = [relative, `${relative}.ts`, `${relative}.js`, `${relative}/index.ts`].find(candidate => sources.has(candidate));
        if (!found) throw new Error(`GrapesJS source missing: ${relative}`);
        return { path: found, namespace: 'grapesjs-source' };
      });
      build.onLoad({ filter: /.*/, namespace: 'grapesjs-source' }, ({ path }) => {
        // Backbone's extend() calls parent.apply(). Upstream also downlevels
        // these classes; leaving native ES classes would break that contract.
        const result = ts.transpileModule(sources.get(path), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES5, module: ts.ModuleKind.ESNext, downlevelIteration: true, esModuleInterop: true } });
        return { contents: result.outputText, loader: 'js', resolveDir: resolve('.') };
      });
      build.onLoad({ filter: /.*/, namespace: 'wordpress-core' }, ({ path }) => ({ contents: globals[path], loader: 'js' }));
    },
  };
}
