import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve('dist');
async function walk(dir) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...(await walk(file)));
    else paths.push(path.relative(root, file).replaceAll('\\', '/'));
  }
  return paths;
}
const files = (await walk(root)).filter((p) => !p.startsWith('_') && p !== 'sw.js').sort();
const template = await readFile('scripts/sw-template.js', 'utf8');
const hash = createHash('sha256').update(template);
for (const file of files) hash.update(file).update(await readFile(path.join(root, file)));
const build = hash.digest('hex').slice(0, 20);
await writeFile(
  path.join(root, 'sw.js'),
  template.replace('__BUILD__', JSON.stringify(build)).replace('__FILES__', JSON.stringify(files)),
);
console.log(`PWA offline shell: ${files.length} files, build ${build}`);
