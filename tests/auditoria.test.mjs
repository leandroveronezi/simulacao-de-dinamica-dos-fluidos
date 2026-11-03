// Regressões achadas na auditoria de interface: cada teste falhava antes da correção.
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp, gestos } from './helpers.mjs';

async function comApp(fn) {
    const app = await abrirApp();
    try { await fn({ ...app, g: gestos(app.page) }); assert.deepEqual(app.erros, [], 'erros no console'); }
    finally { await app.fechar(); }
}

test('o autosave restaura a escala física (fluido e tamanho da célula)', async () => {
    const app = await abrirApp();
    try {
        await app.page.selectOption('#fluidSelect', 'mel');
        await app.page.fill('#cellSizeInput', '5');
        await app.page.dispatchEvent('#cellSizeInput', 'change');
        await app.page.evaluate(() => window.__app._flushAutoSaveSync());
        await app.page.reload();
        await app.page.waitForFunction(() => window.__app && window.__app.solver);
        assert.equal(await app.page.inputValue('#fluidSelect'), 'mel');
        assert.equal(await app.page.inputValue('#cellSizeInput'), '5');
    } finally { await app.fechar(); }
});

test('Ctrl+Z dentro de um campo de texto não desfaz o desenho', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 40], [60, 40]);
    await page.focus('#cellSizeInput');
    await page.keyboard.press('Control+z');
    assert.equal((await g.formas()).length, 1);
}));

test('Novo projeto zera o histórico de desfazer', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 40], [60, 40]);
    await page.evaluate(() => { window.__app.hasUnsavedChanges = false; window.__app._newProject(); });
    await page.evaluate(() => window.__app.undo());
    assert.equal((await g.formas()).length, 0);
    assert.equal(await page.evaluate(() => window.__app.undoStack.length), 0);
}));

test('a seleção arrastada para fora da grade fica limitada à grade', () => comApp(async ({ page }) => {
    const r = await page.evaluate(() => {
        const a = window.__app;
        a.selectionArea = { start: { x: 15, y: 15 }, end: { x: -1, y: -1 } };
        const b = a._getSelectionBounds();
        a._copySelection();
        return { b, tipos: a.clipboard ? a.clipboard.cells.map(c => c.type) : [] };
    });
    assert.deepEqual(r.b, { x_start: 0, x_end: 15, y_start: 0, y_end: 15 });
    assert.ok(r.tipos.every(t => t !== undefined));
}));

test('soltar o mouse fora do canvas não leva a ponta da linha para o canto', () => comApp(async ({ page, g }) => {
    await page.evaluate(() => {
        const a = window.__app;
        a.mouseIsDown = true; a.mouseGridPos = { x: 50, y: 30 };
        a._handleMouseLeave({});
        window.__leaveKept = a.mouseGridPos.x === 50 && a.mouseGridPos.y === 30;
        a.mouseIsDown = false; a._handleMouseLeave({});
        window.__leaveReset = a.mouseGridPos.x === -1;
    });
    assert.equal(await page.evaluate(() => window.__leaveKept), true);
    assert.equal(await page.evaluate(() => window.__leaveReset), true);
}));

test('importar recusa matrizes e grades de tamanho incoerente', () => comApp(async ({ page }) => {
    const erros = await page.evaluate(() => {
        const a = window.__app, cfg = JSON.parse(JSON.stringify(a._buildConfigObject()));
        const tenta = (c) => { try { a._applyConfiguration(c, { silent: true }); return null; } catch (e) { return e.message; } };
        return [
            tenta({ ...cfg, rawCellType: cfg.rawCellType.slice(0, 100) }),
            tenta({ ...cfg, xdim: 3, ydim: 3 }),
            tenta({ ...cfg, sourceVx: [1, 2, 3] }),
            tenta(cfg),
        ];
    });
    assert.ok(erros[0] && erros[1] && erros[2], JSON.stringify(erros));
    assert.equal(erros[3], null, 'a configuração válida continua sendo aceita');
}));

test('o painel de uma Entrada mostra a velocidade em unidades do SI', () => comApp(async ({ page, g }) => {
    await g.linha('source', [15, 40], [15, 70]);
    await g.ferramenta('select');
    await page.evaluate(() => { const a = window.__app; a.selectedShapeIndex = a.shapes.findIndex(s => s.cellType === 3 || s.cellType === window.__app.solver.constructor.CELL_TYPE.SOURCE); a._updateFloatingPanel(); });
    const t = await page.textContent('#floatingPanelSpeedSi');
    assert.match(t, /≈ .*(m|cm|mm)\/s/);
}));
