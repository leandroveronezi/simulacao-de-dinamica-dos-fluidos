// Testes do FluidSolver direto no Node (sem navegador). Rodar: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { FluidSolver } from '../js/FluidSolver.js';

const CT = FluidSolver.CELL_TYPE;
const U0 = 0.1;
const VISC = 0.02;

function makeSolver(w = 80, h = 40) {
    const s = new FluidSolver(w, h);
    s.initFluid(U0);
    return s;
}
function run(s, steps, opts = {}) {
    for (let i = 0; i < steps; i++) s.step({ u0: U0, viscosity: VISC, moveTracers: false, ...opts });
}

test('canal vazio: estável e sem NaN após 500 passos', () => {
    const s = makeSolver();
    run(s, 500);
    assert.ok(s.checkStability());
    for (const v of s.rho) assert.ok(Number.isFinite(v) && v > 0);
});

test('canal vazio: velocidade média próxima de u0', () => {
    const s = makeSolver();
    run(s, 300);
    const x = Math.floor(s.xdim / 2);
    let sum = 0;
    for (let y = 1; y < s.ydim - 1; y++) sum += s.ux[y * s.xdim + x];
    const mean = sum / (s.ydim - 2);
    assert.ok(Math.abs(mean - U0) < 0.03, `ux médio = ${mean}`);
});

test('barreira no canal: estável e fluido não entra na célula sólida', () => {
    const s = makeSolver();
    for (let y = 15; y < 25; y++) s.setCell(30, y, CT.BARRIER);
    run(s, 800);
    assert.ok(s.checkStability());
    assert.equal(s.cellType[20 * s.xdim + 30], CT.BARRIER);
});

test('barreira desacelera o fluxo logo à frente dela', () => {
    const s = makeSolver();
    for (let y = 10; y < 30; y++) s.setCell(30, y, CT.BARRIER);
    run(s, 600);
    assert.ok(s.ux[20 * s.xdim + 28] < U0 * 0.8);
});

test('alta velocidade com baixa viscosidade não produz NaN (limitador)', () => {
    const s = new FluidSolver(60, 30);
    s.initFluid(0.25);
    for (let y = 10; y < 20; y++) s.setCell(20, y, CT.BARRIER);
    for (let i = 0; i < 400; i++) s.step({ u0: 0.25, viscosity: 0.005, moveTracers: false });
    for (let i = 0; i < s.rho.length; i++) {
        assert.ok(Number.isFinite(s.rho[i]) && Number.isFinite(s.ux[i]) && Number.isFinite(s.uy[i]));
    }
});

test('fumaça emitida dentro de uma caixa fechada nunca sai dela', () => {
    const s = makeSolver(80, 40);
    for (let x = 30; x <= 50; x++) { s.setCell(x, 10, CT.BARRIER); s.setCell(x, 30, CT.BARRIER); }
    for (let y = 10; y <= 30; y++) { s.setCell(30, y, CT.BARRIER); s.setCell(50, y, CT.BARRIER); }
    s.dyeSources.push({ x: 40.5, y: 20.5 });
    let ativos = 0;
    for (let i = 0; i < 2000; i++) {
        s.step({ u0: U0, viscosity: VISC, moveTracers: false });
        if (i % 200 !== 199) continue;
        for (const t of s.dyeTracers) {
            if (t.x < 0) continue;
            ativos++;
            assert.ok(t.x > 30 && t.x < 51 && t.y > 10 && t.y < 31, `vazou em (${t.x}, ${t.y}) no passo ${i}`);
        }
    }
    assert.ok(ativos > 0, 'nenhuma partícula de fumaça foi emitida; o teste não verificou nada');
});

test('resize realoca arrays com o novo tamanho', () => {
    const s = makeSolver(40, 20);
    s.resize(64, 32);
    assert.equal(s.rho.length, 64 * 32);
    assert.equal(s.cellType.length, 64 * 32);
});

test('peso da partícula: leve tem raio menor e mais arrasto que pesada', () => {
    const l = FluidSolver.particlePhysicsFromWeight(0);
    const p = FluidSolver.particlePhysicsFromWeight(1);
    assert.ok(l.radius < p.radius);
    assert.ok(l.drag > p.drag);
    assert.ok(l.gravity < p.gravity);
});
