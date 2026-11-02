// O sufixo de cache `?v=...` precisa ser o MESMO em todo import/script servido ao navegador.
// Os mixins de js/app/ importam FluidSimulationApp.js de volta (import circular); se o endereço
// diferir em um caractere, o navegador carrega o módulo duas vezes e o app quebra.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

function arquivosJs(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? arquivosJs(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}
const fontes = [path.join(ROOT, 'index.html'), path.join(ROOT, 'main.js'), ...arquivosJs(path.join(ROOT, 'js'))];

test('todos os imports e scripts usam o mesmo sufixo ?v=', () => {
    const versoes = new Map();
    for (const f of fontes) {
        for (const m of fs.readFileSync(f, 'utf8').matchAll(/\?v=([A-Za-z0-9]+)/g)) {
            versoes.set(m[1], [...(versoes.get(m[1]) || []), path.relative(ROOT, f)]);
        }
    }
    assert.equal(versoes.size, 1, 'versões diferentes: ' + JSON.stringify([...versoes].map(([v, fs_]) => [v, [...new Set(fs_)]])));
});

test('todo import relativo de js/ e main.js leva o sufixo ?v=', () => {
    const sem = [];
    for (const f of fontes.filter(f => f.endsWith('.js'))) {
        for (const m of fs.readFileSync(f, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"\n]*from\s+['"](\.[^'"]+)['"]/gm)) {
            if (!m[1].includes('?v=')) sem.push(`${path.relative(ROOT, f)}: ${m[1]}`);
        }
        for (const m of fs.readFileSync(f, 'utf8').matchAll(/import\(\s*['"](\.[^'"]+)['"]/g)) {
            if (!m[1].includes('?v=')) sem.push(`${path.relative(ROOT, f)}: import(${m[1]})`);
        }
    }
    assert.deepEqual(sem, []);
});
