// Edição de formas por gestos reais: selecionar, mover, esticar, painel de propriedades,
// apagar/desfazer, direção da Entrada, pivô do Rotor, corte pela Borracha, Válvula e menus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { abrirApp, gestos, aguardarLayoutEstavel } from './helpers.mjs';

async function comApp(fn) {
    const app = await abrirApp();
    try { await fn({ ...app, g: gestos(app.page) }); assert.deepEqual(app.erros, [], 'erros no console'); }
    finally { await app.fechar(); }
}
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

test('Ponteiro seleciona a linha e o painel mostra comprimento e ângulo', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 60], [60, 60]);
    await g.ferramenta('pointer'); await g.click([45, 60]);
    await page.waitForFunction(() => !document.getElementById('floatingPropertyPanel').hidden);
    perto(Number(await page.inputValue('#floatingPanelLengthInput')), 30, 1.5, 'comprimento');
    perto(Math.abs(Number(await page.inputValue('#floatingPanelAngleInput'))) % 180, 0, 1, 'ângulo');
}));

test('painel: espessura da linha é gravada na forma', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 60], [60, 60]);
    await g.ferramenta('pointer'); await g.click([45, 60]);
    await page.waitForFunction(() => !document.getElementById('floatingPropertyPanel').hidden);
    await page.fill('#floatingPanelLineWidthInput', '3');
    await page.press('#floatingPanelLineWidthInput', 'Enter');
    assert.equal((await g.formas())[0].lineWidth, 3);
    // Fora do intervalo é limitado (1 a 4).
    await page.fill('#floatingPanelLineWidthInput', '99');
    await page.press('#floatingPanelLineWidthInput', 'Enter');
    assert.equal((await g.formas())[0].lineWidth, 4);
}));

test('Ponteiro: arrastar o corpo move a forma inteira', () => comApp(async ({ g }) => {
    await g.linha('barrier', [30, 60], [60, 60]);
    await g.ferramenta('pointer'); await g.click([45, 60]);
    await g.drag([45, 60], [45, 80]);
    const f = (await g.formas())[0];
    perto(f.y0, 80, 1, 'y0'); perto(f.y1, 80, 1, 'y1');
    perto(f.x0, 30, 1, 'x0'); perto(f.x1, 60, 1, 'x1');
}));

test('Ponteiro: arrastar a ponta estica a linha', () => comApp(async ({ g }) => {
    await g.linha('barrier', [30, 60], [60, 60]);
    await g.ferramenta('pointer'); await g.click([45, 60]);
    await g.drag([60, 60], [80, 60]);
    const f = (await g.formas())[0];
    perto(Math.max(f.x0, f.x1), 80, 1, 'ponta esticada');
    perto(Math.min(f.x0, f.x1), 30, 1, 'ponta fixa');
}));

test('Delete apaga a forma selecionada e Ctrl+Z a traz de volta', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 60], [60, 60]);
    const solidas = () => page.evaluate(() => Array.from(window.__app.solver.cellType).filter(v => v === 1).length);
    const antes = await solidas();
    assert.ok(antes > 0);
    await g.ferramenta('pointer'); await g.click([45, 60]);
    await page.keyboard.press('Delete');
    assert.equal((await g.formas()).length, 0);
    assert.equal(await solidas(), 0);
    await page.keyboard.press('Control+z');
    assert.equal((await g.formas()).length, 1);
    assert.equal(await solidas(), antes);
}));

test('Entrada: velocidade e ângulo do fluxo pelo painel atualizam forma, grupo e solver', () => comApp(async ({ page, g }) => {
    await g.linha('source', [30, 60], [30, 80]);
    // Clicar na ORIGEM (centro) inicia o arraste da seta; para selecionar a forma e abrir o
    // painel, clica-se no corpo da linha, longe da origem e da ponta da seta.
    await g.ferramenta('pointer'); await g.click([30, 62]);
    await page.waitForFunction(() => !document.getElementById('floatingPanelSourceControls').hidden);
    await page.fill('#floatingPanelSpeedInput', '0.1');
    await page.press('#floatingPanelSpeedInput', 'Enter');
    await page.fill('#floatingPanelFlowAngleInput', '90');
    await page.press('#floatingPanelFlowAngleInput', 'Enter');
    const r = await page.evaluate(() => {
        const a = window.__app, s = a.shapes[0], gr = a.solver.sourceGroups[0], c = gr.cells[0];
        return { vx: s.vx, vy: s.vy, gvx: gr.vx, gvy: gr.vy, cvx: a.solver.sourceVx[c.x + c.y * a.solver.xdim], cvy: a.solver.sourceVy[c.x + c.y * a.solver.xdim] };
    });
    perto(r.vx, 0, 0.002, 'vx'); perto(r.vy, 0.1, 0.002, 'vy');
    perto(r.gvx, r.vx, 1e-6, 'grupo vx'); perto(r.gvy, r.vy, 1e-6, 'grupo vy');
    perto(r.cvx, r.vx, 1e-6, 'célula vx'); perto(r.cvy, r.vy, 1e-6, 'célula vy');
}));

test('Entrada: arrastar a ponta da seta redireciona o fluxo', () => comApp(async ({ page, g }) => {
    await g.linha('source', [30, 60], [30, 80]);
    await g.ferramenta('pointer'); await g.click([30, 62]);
    await page.waitForFunction(() => !document.getElementById('floatingPanelSourceControls').hidden);
    await page.fill('#floatingPanelSpeedInput', '0.05');
    await page.press('#floatingPanelSpeedInput', 'Enter');
    await page.fill('#floatingPanelFlowAngleInput', '0');
    await page.press('#floatingPanelFlowAngleInput', 'Enter');
    // O painel flutuante abre ao lado da forma e pode cobrir a ponta da seta: fecha antes de arrastar.
    await page.click('#floatingPanelCloseButton');
    await aguardarLayoutEstavel(page);
    const tip = await page.evaluate(() => {
        const a = window.__app, gr = a.solver.sourceGroups[0], k = 300 / a.pxPerSquare;
        return [gr.originX + gr.vx * k, gr.originY + gr.vy * k];
    });
    // Arrasta a ponta 10 células à direita da origem: velocidade = 10/20 do máximo (0,15).
    const origem = await page.evaluate(() => { const gr = window.__app.solver.sourceGroups[0]; return [gr.originX, gr.originY]; });
    await g.drag(tip.map(Math.round), [origem[0] + 10, origem[1]]);
    const gr = await page.evaluate(() => { const x = window.__app.solver.sourceGroups[0]; return { vx: x.vx, vy: x.vy }; });
    perto(gr.vx, 0.075, 0.015, 'vx após arrastar'); perto(gr.vy, 0, 0.01, 'vy após arrastar');
}));

test('Rotor: arrastar o pivô move o eixo sem mover a forma', () => comApp(async ({ page, g }) => {
    await g.linha('rotor', [60, 100], [60, 110]);
    const antes = await page.evaluate(() => { const b = window.__app.solver.rotatingBodies[0]; return { px: b.pivotX, py: b.pivotY, n: b.currentCells.length }; });
    await g.ferramenta('pointer');
    await g.drag([Math.round(antes.px), Math.round(antes.py)], [Math.round(antes.px), Math.round(antes.py) - 4]);
    const depois = await page.evaluate(() => { const b = window.__app.solver.rotatingBodies[0]; return { px: b.pivotX, py: b.pivotY, n: b.currentCells.length, ang: b.angle }; });
    perto(depois.py, antes.py - 4, 1, 'pivô y'); perto(depois.px, antes.px, 1, 'pivô x');
    assert.equal(depois.n, antes.n, 'a forma não deve mudar');
    assert.equal(depois.ang, 0);
}));

test('Borracha corta a linha em duas formas independentes', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 120], [90, 120]);
    await g.ferramenta('eraser'); await g.drag([55, 118], [65, 122]);
    const f = await g.formas();
    assert.equal(f.length, 2, JSON.stringify(f.map(s => [s.tool, s.x0, s.x1])));
    const xs = f.map(s => [Math.min(s.x0, s.x1), Math.max(s.x0, s.x1)]).sort((a, b) => a[0] - b[0]);
    perto(xs[0][0], 30, 1, 'início 1'); assert.ok(xs[0][1] < 56, `fim 1 = ${xs[0][1]}`);
    assert.ok(xs[1][0] > 64, `início 2 = ${xs[1][0]}`); perto(xs[1][1], 90, 1, 'fim 2');
    // E o buraco está de fato aberto no solver.
    const vazio = await page.evaluate(() => { const a = window.__app, s = a.solver; return s.cellType[60 + 120 * s.xdim]; });
    assert.equal(vazio, 0);
}));

test('Válvula nasce fechada e o interruptor abre e fecha a passagem', () => comApp(async ({ page, g }) => {
    await g.linha('valve', [100, 100], [100, 115]);
    const tipoCelula = () => page.evaluate(() => { const s = window.__app.solver; return s.cellType[100 + 107 * s.xdim]; });
    assert.equal(await tipoCelula(), 1, 'fechada = bloqueia como Barreira');
    await page.waitForSelector('#controlPanelBar:not([hidden]) .control-unit-switch');
    await page.check('#controlPanelBar .control-unit-switch');
    assert.equal(await tipoCelula(), 0, 'aberta = passagem');
    assert.equal((await g.formas())[0].enabled, true);
    await page.uncheck('#controlPanelBar .control-unit-switch');
    assert.equal(await tipoCelula(), 1);
    // O painel de controle some quando não há mais Entrada/Saída/Válvula.
    await page.evaluate(() => window.__app.clearBarriers());
    assert.equal(await page.evaluate(() => document.getElementById('controlPanelBar').hidden), true);
}));

test('Entrada e Saída aparecem no painel de controle com rótulos E1/S1', () => comApp(async ({ page, g }) => {
    await g.linha('source', [20, 60], [20, 80]);
    await g.linha('sink', [150, 60], [150, 80]);
    const rotulos = await page.$$eval('#controlPanelBar .control-unit-label', els => els.map(e => e.textContent.trim()));
    assert.deepEqual(rotulos, ['E1', 'S1']);
}));

test('tamanho da grade: aplicar recria o solver no novo tamanho (e valida limites)', () => comApp(async ({ page, g }) => {
    await g.linha('barrier', [30, 60], [60, 60]);
    await page.fill('#gridWidthInput', '120'); await page.fill('#gridHeightInput', '80');
    await page.click('#applyGridSizeButton');
    await page.click('.swal2-confirm');
    await page.waitForFunction(() => window.__app.solver.xdim === 120 && window.__app.solver.ydim === 80);
    assert.equal((await g.formas()).length, 0, 'a cena é recriada do zero');
    // Tamanho inválido: mostra erro e restaura os campos.
    await page.fill('#gridWidthInput', '5');
    await page.click('#applyGridSizeButton');
    await page.waitForSelector('.swal2-popup');
    assert.match(await page.textContent('.swal2-popup'), /Tamanho inválido/);
    await page.click('.swal2-confirm');
    assert.equal(await page.inputValue('#gridWidthInput'), '120');
}));

test('menu Arquivo abre ao clicar e fecha ao clicar fora', () => comApp(async ({ page }) => {
    const aberto = () => page.evaluate(() => document.querySelectorAll('.menu-dropdown.open').length);
    await page.click('.menu-trigger >> nth=0');
    assert.equal(await aberto(), 1);
    await page.mouse.click(700, 500);
    assert.equal(await aberto(), 0);
}));

test('tooltip aparece após o atraso ao passar o mouse sobre um botão com title', () => comApp(async ({ page }) => {
    await page.hover('#startButton');
    await page.waitForFunction(() => document.getElementById('app-tooltip').classList.contains('visible'), null, { timeout: 3000 });
    assert.match(await page.textContent('#app-tooltip'), /Iniciar/i);
    await page.mouse.move(700, 500);
    await page.waitForFunction(() => !document.getElementById('app-tooltip').classList.contains('visible'));
}));
