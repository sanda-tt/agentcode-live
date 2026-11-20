import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';

for (const [name, grammar] of Object.entries({ bash, c, cpp, css, go, javascript, json, python, rust, typescript, xml })) {
  hljs.registerLanguage(name, grammar);
}

const languageByExtension = new Map(Object.entries({
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', json: 'json', jsonc: 'json',
  css: 'css', html: 'xml', xml: 'xml', svg: 'xml',
  py: 'python', rs: 'rust', go: 'go', sh: 'bash', bash: 'bash',
}));

export function languageFor(path) {
  return languageByExtension.get(path.split('.').pop().toLowerCase());
}

export function writeCode(node, source, language) {
  // The highlighter escapes source text and emits its own token spans.
  if (language) node.innerHTML = hljs.highlight(source, { language, ignoreIllegals: true }).value;
  else node.textContent = source;
}
