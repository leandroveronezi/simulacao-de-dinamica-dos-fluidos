// Escala física: conversões puras (Node) e o painel na interface (Chrome real).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FLUIDOS, calcularEscala, calibrar, formatarVelocidade, formatarTempo, formatarComprimento } from '../js/Unidades.js';

test('dt e escala de velocidade seguem ν_rede = ν_real·dt/dx²', () => {
    const e = calcularEscala({ nuFisico: FLUIDOS.ar.nu, tamanhoCelulaM: 1e-3, nuRede: 0.02 });
    assert.ok(Math.abs(e.dt - 0.02 * 1e-6 / 1.5e-5) < 1e-12);
    // O mesmo ν real recuperado a partir da escala:
    assert.ok(Math.abs(0.02 * e.comprimento ** 2 / e.dt - FLUIDOS.ar.nu) / FLUIDOS.ar.nu < 1e-12);
    assert.ok(Math.abs(e.velocidade - e.comprimento / e.dt) < 1e-12);
});

test('o número de Reynolds é o mesmo na rede e no mundo real', () => {
    const nuFisico = FLUIDOS.agua.nu, dx = 5e-4, nuRede = 0.03, uRede = 0.04, DRede = 16;
    const e = calcularEscala({ nuFisico, tamanhoCelulaM: dx, nuRede });
    const reRede = uRede * DRede / nuRede;
    const reReal = (uRede * e.velocidade) * (DRede * dx) / nuFisico;
    assert.ok(Math.abs(reRede - reReal) / reRede < 1e-12);
});

test('calibrar reproduz a velocidade pedida quando cabe nos limites', () => {
    const r = calibrar({ nuFisico: FLUIDOS.ar.nu, tamanhoCelulaM: 1e-3, velocidade: 0.1 });
    assert.equal(r.limitado, false, r.motivo);
    assert.ok(Math.abs(r.velocidadeObtida - 0.1) / 0.1 < 0.2, `obtida ${r.velocidadeObtida}`);
    assert.ok(r.nuRede >= 0.005 && r.nuRede <= 0.2 && r.uRede <= 0.1);
});

test('calibrar avisa quando a viscosidade de rede necessária sai da faixa', () => {
    // Água a 1 m/s com células de 1 mm: Re enorme, ν_rede necessária ≈ 2,5e-5 << 0,005.
    const r = calibrar({ nuFisico: FLUIDOS.agua.nu, tamanhoCelulaM: 1e-3, velocidade: 1 });
    assert.equal(r.limitado, true);
    assert.equal(r.nuRede, 0.005);
    assert.ok(r.uRede <= 0.1);
    assert.ok(r.velocidadeObtida < 1, 'não pode prometer a velocidade pedida');
});

test('formatadores promovem a unidade ao arredondar e tratam valores fora do domínio', () => {
    assert.equal(formatarTempo(0.0009999), '1 ms');
    assert.equal(formatarTempo(0.99999), '1 s');
    assert.equal(formatarVelocidade(0.9996), '1 m/s');
    assert.equal(formatarComprimento(0.0099999), '1 cm');
    assert.equal(formatarVelocidade(NaN), '—');
    assert.equal(formatarTempo(0), '0 s');
    assert.equal(formatarVelocidade(1e-12), '~0 m/s');
});

test('calibrar recusa entradas inválidas e sinaliza a velocidade mínima', () => {
    for (const ruim of [0, -1, NaN, Infinity]) {
        assert.throws(() => calibrar({ nuFisico: 1.5e-5, tamanhoCelulaM: 1e-3, velocidade: ruim }), RangeError);
        assert.throws(() => calibrar({ nuFisico: 1.5e-5, tamanhoCelulaM: ruim, velocidade: 0.1 }), RangeError);
    }
    const r = calibrar({ nuFisico: FLUIDOS.ar.nu, tamanhoCelulaM: 1e-3, velocidade: 3e-4 });
    assert.equal(r.limitado, true);
    assert.ok(r.velocidadeObtida > 3e-4, 'a velocidade mínima de rede passa da pedida');
});

test('formatadores escolhem a unidade legível', () => {
    assert.match(formatarVelocidade(2.5), /m\/s/);
    assert.match(formatarVelocidade(0.12), /cm\/s/);
    assert.match(formatarVelocidade(0.003), /mm\/s/);
    assert.match(formatarTempo(0.00133), /ms/);
    assert.match(formatarComprimento(0.3), /cm/);
});

// ---- interface ----
import { abrirApp } from './helpers.mjs';

async function comApp(fn) {
    const app = await abrirApp();
    try { await fn(app); assert.deepEqual(app.erros, [], 'erros no console'); }
    finally { await app.fechar(); }
}

test('o painel mostra o passo de tempo e o fluxo em m/s, e acompanha os sliders', () => comApp(async ({ page }) => {
    const texto = () => page.textContent('#physicalScaleReadout');
    const antes = await texto();
    assert.match(antes, /1 passo = .*ms/);
    assert.match(await page.textContent('#speedValue'), /\(.*m\/s\)/);
    await page.evaluate(() => { const s = document.querySelector('#viscSlider'); s.value = 0.1; s.dispatchEvent(new Event('input')); });
    assert.notEqual(await texto(), antes, 'mudar a viscosidade de rede muda o passo de tempo');
    await page.selectOption('#fluidSelect', 'agua');
    assert.match(await texto(), /1,0e-6 m²\/s/);
}));

test('Calibrar ajusta os sliders para a velocidade real pedida', () => comApp(async ({ page }) => {
    await page.selectOption('#fluidSelect', 'ar');
    await page.fill('#cellSizeInput', '1');
    await page.fill('#targetSpeedInput', '0.1');
    await page.click('#calibrateButton');
    const u = Number(await page.inputValue('#speedSlider')), nu = Number(await page.inputValue('#viscSlider'));
    const ms = u * (1e-3 / (nu * 1e-6 / 1.5e-5));
    assert.ok(Math.abs(ms - 0.1) / 0.1 < 0.2, `fluxo ${ms} m/s`);
}));

test('a escala vai e volta no JSON exportado', () => comApp(async ({ page }) => {
    await page.selectOption('#fluidSelect', 'agua');
    await page.fill('#cellSizeInput', '2.5');
    await page.dispatchEvent('#cellSizeInput', 'input');
    const cfg = await page.evaluate(() => window.__app._buildConfigObject());
    assert.deepEqual(cfg.physicalScale, { fluid: 'agua', cellSizeMm: 2.5 });
    await page.selectOption('#fluidSelect', 'ar');
    await page.evaluate((c) => window.__app._applyConfiguration(c, { silent: true }), cfg);
    assert.equal(await page.inputValue('#fluidSelect'), 'agua');
    assert.equal(await page.inputValue('#cellSizeInput'), '2.5');
}));
