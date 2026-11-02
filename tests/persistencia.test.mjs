// Autosave, projetos nomeados e exportar/importar: ida e volta no navegador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp } from './helpers.mjs';

async function desenhaLinha(page, tipo, a, b) {
    const pt = (gx, gy) => page.evaluate(([x, y]) => {
        const ap = window.__app, c = ap.gridToCanvas(x, y), r = ap.canvas.getBoundingClientRect();
        return { x: r.left + c.x * r.width / ap.canvas.width, y: r.top + c.y * r.height / ap.canvas.height };
    }, [gx, gy]);
    await page.click('.tool-button[data-tool="line"]');
    await page.click(`.paint-type-button[data-paint-type="${tipo}"]`);
    const p = await pt(...a), q = await pt(...b);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(q.x, q.y, { steps: 5 }); await page.mouse.up();
}
const resumo = (page) => page.evaluate(() => {
    const c = window.__app._buildConfigObject();
    return { n: c.shapes.length, tipos: c.shapes.map(s => s.cellType), cells: Array.from(window.__app.solver.cellType).reduce((s, v) => s + (v ? 1 : 0), 0), xdim: c.xdim, ydim: c.ydim };
});

test('exportar e importar a configuração preserva o desenho', async () => {
    const { page, erros, fechar } = await abrirApp();
    try {
        await desenhaLinha(page, 'barrier', [30, 30], [60, 50]);
        await desenhaLinha(page, 'mesh', [90, 30], [90, 60]);
        const antes = await resumo(page);
        assert.ok(antes.n === 2 && antes.cells > 0, JSON.stringify(antes));
        const cfg = await page.evaluate(() => JSON.parse(JSON.stringify(window.__app._buildConfigObject())));
        await page.evaluate(() => window.__app.clearBarriers());
        assert.equal((await resumo(page)).n, 0, 'clearBarriers não limpou');
        await page.evaluate((c) => window.__app._applyConfiguration(c, { silent: true }), cfg);
        assert.deepEqual(await resumo(page), antes);
        assert.deepEqual(erros, []);
    } finally { await fechar(); }
});

test('autosave: recarregar a página restaura o desenho', async () => {
    const { page, erros, url, fechar } = await abrirApp();
    try {
        await desenhaLinha(page, 'barrier', [30, 30], [60, 50]);
        const antes = await resumo(page);
        await page.evaluate(() => window.__app._flushAutoSaveSync());
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.__app);
        assert.deepEqual(await resumo(page), antes);
        assert.deepEqual(erros, []);
    } finally { await fechar(); }
});

test('projetos nomeados: salvar, listar, abrir e excluir', async () => {
    const { page, erros, fechar } = await abrirApp();
    try {
        await desenhaLinha(page, 'barrier', [30, 30], [60, 50]);
        const antes = await resumo(page);
        // _saveProjectAs pede o nome por um diálogo (SweetAlert2): contorna escrevendo direto no
        // armazenamento pelo mesmo caminho que o app usa para persistir a lista.
        const id = await page.evaluate(() => {
            const a = window.__app;
            const projetos = a._listProjects();
            const p = { id: 'teste-1', name: 'Projeto de teste', savedAt: Date.now(), config: a._buildConfigObject() };
            a._persistProjects([...projetos, p]);
            return p.id;
        });
        assert.equal(await page.evaluate(() => window.__app._listProjects().length), 1);
        await page.evaluate(() => window.__app.clearBarriers());
        await page.evaluate((i) => window.__app._loadProject(i), id);
        assert.deepEqual(await resumo(page), antes);
        await page.evaluate((i) => {
            const a = window.__app;
            a._persistProjects(a._listProjects().filter(p => p.id !== i));
        }, id);
        assert.equal(await page.evaluate(() => window.__app._listProjects().length), 0);
        assert.deepEqual(erros, []);
    } finally { await fechar(); }
});
