// Leis físicas que o solver precisa respeitar (conservação, dissipação, repouso, sentido de giro).
// Estes testes existem porque os de comportamento isolado não pegavam, por exemplo, uma caixa
// fechada perdendo massa pelas paredes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FluidSolver } from '../js/FluidSolver.js';

const CT = FluidSolver.CELL_TYPE;
const VISC_PADRAO = 0.02; // padrão do slider do app
const step = (s, n, u0 = 0, v = VISC_PADRAO) => { for (let i = 0; i < n; i++) s.step({ u0, viscosity: v, moveTracers: false }); };
const soma = (s, i) => s.n0[i] + s.nN[i] + s.nS[i] + s.nE[i] + s.nW[i] + s.nNE[i] + s.nSE[i] + s.nNW[i] + s.nSW[i];

// Caixa fechada (parede de 1 célula, afastada da borda do domínio) com uma perturbação no meio.
function caixaFechada(visc = VISC_PADRAO, blobU = 0.05) {
    const W = 60, H = 40, x0 = 3, x1 = 56, y0 = 3, y1 = 36;
    const s = new FluidSolver(W, H); s.boundaryMode = 'open'; s.initFluid(0);
    for (let x = x0; x <= x1; x++) { s.setCell(x, y0, CT.BARRIER); s.setCell(x, y1, CT.BARRIER); }
    for (let y = y0; y <= y1; y++) { s.setCell(x0, y, CT.BARRIER); s.setCell(x1, y, CT.BARRIER); }
    for (let y = 15; y < 25; y++) for (let x = 25; x < 35; x++) s.setEquilibrium(x, y, blobU, blobU * 0.6, 1);
    const dentro = i => { const x = i % W, y = (i / W) | 0; return x > x0 && x < x1 && y > y0 && y < y1; };
    const parede = i => s.cellType[i] === CT.BARRIER;
    return {
        s, step: (n) => step(s, n, 0, visc),
        massa: () => { let m = 0; for (let i = 0; i < W * H; i++) if (dentro(i)) m += soma(s, i); return m; },
        energia: () => { let e = 0; for (let i = 0; i < W * H; i++) if (dentro(i)) e += s.ux[i] ** 2 + s.uy[i] ** 2; return e; },
        rhoParede: () => { let m = 0, n = 0; for (let i = 0; i < W * H; i++) if (parede(i)) { m += soma(s, i); n++; } return m / n; }
    };
}

test('caixa fechada conserva a massa com a viscosidade padrão (6000 passos)', () => {
    const c = caixaFechada(); c.step(1); const m0 = c.massa();
    for (let k = 0; k < 6; k++) { c.step(1000); assert.ok(Math.abs(c.massa() / m0 - 1) < 1e-3, `massa/inicial = ${c.massa() / m0} após ${(k + 1) * 1000} passos`); }
});

test('caixa fechada conserva a massa também com viscosidade baixa', () => {
    const c = caixaFechada(0.01); c.step(1); const m0 = c.massa();
    c.step(5000);
    assert.ok(Math.abs(c.massa() / m0 - 1) < 1e-3, `massa/inicial = ${c.massa() / m0}`);
});

test('paredes sólidas não acumulam nem perdem massa (densidade da parede continua ~1)', () => {
    const c = caixaFechada(); c.step(5000);
    assert.ok(Math.abs(c.rhoParede() - 1) < 0.02, `rho médio da parede = ${c.rhoParede()}`);
});

test('sem forçamento o envelope da energia cinética decai (ondas acústicas trocam energia, mas não a criam)', () => {
    const c = caixaFechada(); c.step(200);
    const e0 = c.energia();
    // Numa caixa fechada há ondas estacionárias (período ~100-200 passos) que trocam energia
    // entre pressão e velocidade; a energia cinética instantânea oscila. O que não pode é o
    // MÁXIMO por janela voltar a crescer: amostra a cada 25 passos e compara janelas de 500.
    const maxJanela = () => { let m = 0; for (let i = 0; i < 20; i++) { c.step(25); m = Math.max(m, c.energia()); } return m; };
    let anterior = maxJanela();
    for (let k = 0; k < 8; k++) {
        const m = maxJanela();
        assert.ok(m <= anterior * 1.05, `envelope subiu: ${anterior} -> ${m} (janela ${k})`);
        anterior = m;
    }
    assert.ok(anterior < 0.02 * e0, `envelope final ainda alto: ${anterior / e0} da energia inicial`);
});

test('fluido em repouso permanece exatamente em repouso', () => {
    const s = new FluidSolver(80, 40); s.boundaryMode = 'open'; s.initFluid(0); step(s, 3000);
    let m = 0; for (let i = 0; i < s.ux.length; i++) m = Math.max(m, Math.abs(s.ux[i]), Math.abs(s.uy[i]));
    assert.equal(m, 0);
});

test('espelhamento: obstáculo simétrico com vento simétrico dá campo simétrico', () => {
    const W = 100, H = 41, s = new FluidSolver(W, H); s.initFluid(0.05);
    for (let y = 15; y <= 25; y++) s.setCell(30, y, CT.BARRIER);
    step(s, 600, 0.05);
    let a = 0;
    for (let y = 1; y < 20; y++) for (let x = 0; x < W; x++) a = Math.max(a, Math.abs(s.ux[x + y * W] - s.ux[x + (40 - y) * W]));
    assert.ok(a < 1e-5, `assimetria = ${a}`);
});


// "Parou" = o ângulo não anda. A velocidade angular tem um jitter de ~1e-4 rad/passo (ruído
// acústico do fluido, ora positivo ora negativo) que não gira nada; por isso o critério é a
// variação do ângulo numa janela, não o valor instantâneo de omega.
// Com amortecimento 0 sobra uma rotação residual de ~2e-5 rad/passo: é o fluido que o próprio
// rotor pôs em giro e que o arrasta; só a viscosidade o dissipa (escala de dezenas de milhares de
// passos). Por isso a tolerância é de 0,1 rad por 2000 passos (5e-5 rad/passo, uma volta em ~35 min a
// 200 passos/s), muito abaixo de qualquer giro visível.
function assentou(s, passos = 2000, tolAngulo = 0.1) {
    const b = s.rotatingBodies[0], a0 = b.angle;
    step(s, passos);
    assert.ok(Math.abs(b.angle - a0) < tolAngulo, `ainda girando: o ângulo andou ${b.angle - a0} rad em ${passos} passos`);
    assert.ok(Math.abs(b.omega) < 1e-3, `omega = ${b.omega}`);
}

function rotorLivre(sentidoVento) {
    const s = new FluidSolver(80, 40); s.boundaryMode = 'open'; s.initFluid(0);
    const xsrc = sentidoVento > 0 ? 5 : 75, src = [];
    for (let y = 5; y <= 35; y++) src.push({ x: xsrc, y });
    s.addSourceGroup(src, 0.1 * sentidoVento, 0);
    for (const c of src) s.setCell(c.x, c.y, CT.SOURCE);
    const pa = []; for (let y = 20; y <= 30; y++) pa.push({ x: 40, y });
    s.addRotatingBody(pa, { x: 40, y: 20 }, { damping: 0.02 }); s.stampRotatingBodiesOntoGrid();
    return s;
}

test('vento de lados opostos gira a pá em sentidos opostos', () => {
    const a = rotorLivre(+1), b = rotorLivre(-1);
    step(a, 2500); step(b, 2500);
    const ang = (s) => s.rotatingBodies[0].angle;
    assert.ok(ang(a) < -0.3, `vento → : ${ang(a)}`);
    assert.ok(ang(b) > 0.3, `vento ← : ${ang(b)}`);
});

test('rotor lançado em fluido parado desacelera até praticamente parar', () => {
    for (const damping of [0, 0.05]) {
        const s = new FluidSolver(80, 40); s.boundaryMode = 'open'; s.initFluid(0);
        const cells = []; for (let y = 13; y <= 27; y++) cells.push({ x: 40, y });
        s.addRotatingBody(cells, null, { damping }); s.stampRotatingBodiesOntoGrid();
        const b = s.rotatingBodies[0]; b.omega = 0.03;
        step(s, 5000);
        assentou(s);
    }
});

test('rotor para depois que o vento é cortado', () => {
    const s = rotorLivre(+1);
    step(s, 2500);
    for (const g of s.sourceGroups) s.updateSourceGroupVelocity(s.sourceGroups.indexOf(g), 0, 0);
    step(s, 6000);
    assentou(s);
});

test('motor desligado: o rotor perde a velocidade por inércia', () => {
    const s = new FluidSolver(80, 40); s.boundaryMode = 'open'; s.initFluid(0);
    const cells = []; for (let y = 13; y <= 27; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, null, { motorDirection: 1, motorSpeed: 0.5, damping: 0.02 }); s.stampRotatingBodiesOntoGrid();
    const b = s.rotatingBodies[0];
    step(s, 1500); const ligado = Math.abs(b.omega);
    assert.ok(ligado > 1e-3, `motor não girou: ${ligado}`);
    b.motorDirection = 0; step(s, 3000);
    assert.ok(Math.abs(b.omega) < 0.1 * ligado, `omega ${ligado} -> ${b.omega}`);
});

test('continuidade: num canal com estreitamento o fluxo de massa se mantém e a velocidade sobe', () => {
    const W = 160, H = 40, s = new FluidSolver(W, H); s.initFluid(0.05);
    for (let x = 70; x < 90; x++) for (let y = 0; y < 10; y++) { s.setCell(x, y, CT.BARRIER); s.setCell(x, 39 - y, CT.BARRIER); }
    step(s, 5000, 0.05);
    const fluxo = x => { let f = 0; for (let y = 0; y < H; y++) if (!s.cellType[x + y * W]) f += s.rho[x + y * W] * s.ux[x + y * W]; return f; };
    const f0 = fluxo(40);
    for (const x of [20, 60, 80, 100, 140]) assert.ok(Math.abs(fluxo(x) / f0 - 1) < 0.06, `fluxo em x=${x}: ${fluxo(x)} vs ${f0}`);
    // Metade da seção livre => velocidade média ~2x (tolerância larga: o LBM é levemente compressível).
    const razao = (fluxo(80) / 20) / (fluxo(40) / 40);
    assert.ok(razao > 1.8 && razao < 2.2, `razão de velocidades = ${razao}`);
});

// Força do fluido sobre a barreira (seta "Força"): num canal com vento uniforme o arrasto médio
// sobre um obstáculo aponta A FAVOR do vento (antes do conserto o sinal estava trocado).
test('o arrasto médio sobre um cilindro no canal aponta a favor do vento, com sustentação ~0', () => {
    const W = 200, H = 80, D = 16, U = 0.08, s = new FluidSolver(W, H); s.initFluid(U);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 60) ** 2 + (y - 40) ** 2 <= (D / 2) ** 2) s.setCell(x, y, CT.BARRIER);
    step(s, 4000, U, U * D / 100);
    let fx = 0, fy = 0; const N = 2000;
    for (let i = 0; i < N; i++) { step(s, 1, U, U * D / 100); fx += s.barrierFx; fy += s.barrierFy; }
    fx /= N; fy /= N;
    const cd = 2 * fx / (U * U * D);
    assert.ok(fx > 0, `Fx médio = ${fx} (deve ser positivo: a favor do vento)`);
    assert.ok(cd > 0.8 && cd < 2.5, `Cd = ${cd} (esperado ~1,3 a 1,6 a Re=100 com bloqueio)`);
    assert.ok(Math.abs(fy) < 0.15 * fx, `sustentação média Fy = ${fy} vs arrasto ${fx}`);
});

test('cilindro a Re=100 desprende vórtices com Strouhal na faixa da literatura (0,15 a 0,22)', () => {
    const W = 260, H = 80, D = 16, U = 0.08, visc = U * D / 100, cx = 60, cy = 40;
    const s = new FluidSolver(W, H); s.initFluid(U);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= (D / 2) ** 2) s.setCell(x, y, CT.BARRIER);
    const sonda = [];
    for (let i = 0; i < 20000; i++) { s.step({ u0: U, viscosity: visc, moveTracers: false }); if (i > 8000 && i % 5 === 0) sonda.push(s.uy[(cx + 4 * D) + cy * W]); }
    const m = sonda.reduce((a, b) => a + b, 0) / sonda.length; let cruz = 0;
    for (let i = 1; i < sonda.length; i++) if ((sonda[i - 1] - m) * (sonda[i] - m) < 0) cruz++;
    const St = (cruz / 2 / (sonda.length * 5)) * D / U;
    assert.ok(cruz / 2 >= 5, `poucos ciclos de desprendimento: ${cruz / 2}`);
    assert.ok(St > 0.15 && St < 0.22, `St = ${St}`);
});

// Um motor girando numa caixa selada não pode criar nem destruir ar (nem desestabilizar o resto).
function caixaComMotor() {
    const W = 80, H = 60, x0 = 3, x1 = 76, y0 = 3, y1 = 56;
    const s = new FluidSolver(W, H); s.boundaryMode = 'open'; s.initFluid(0);
    for (let x = x0; x <= x1; x++) { s.setCell(x, y0, CT.BARRIER); s.setCell(x, y1, CT.BARRIER); }
    for (let y = y0; y <= y1; y++) { s.setCell(x0, y, CT.BARRIER); s.setCell(x1, y, CT.BARRIER); }
    const cells = []; for (let y = 20; y <= 40; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, null, { motorDirection: 1, motorSpeed: 1, damping: 0.02 }); s.stampRotatingBodiesOntoGrid();
    const dentro = i => { const x = i % W, y = (i / W) | 0; return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
    const massa = (fn) => { let m = 0; for (let i = 0; i < W * H; i++) if (fn(i)) m += soma(s, i); return m; };
    return { s, interno: () => massa(dentro), externo: () => massa(i => !dentro(i)) };
}

test('motor ligado numa caixa selada conserva a massa (interior + paredes + rotor)', () => {
    const c = caixaComMotor(); step(c.s, 300);
    const m0 = c.interno();
    step(c.s, 6000);
    assert.ok(Math.abs(c.interno() / m0 - 1) < 1e-3, `massa/inicial = ${c.interno() / m0}`);
    assert.ok(Math.abs(c.s.rotatingBodies[0].omega) > 1e-3, 'o motor tem que estar girando para o teste valer');
    assert.ok(c.s.checkStability());
});

test('a correção de massa do rotor não perturba a região em repouso fora da caixa', () => {
    const c = caixaComMotor(); step(c.s, 300);
    const e0 = c.externo();
    step(c.s, 4000);
    assert.ok(Math.abs(c.externo() / e0 - 1) < 1e-4, `massa externa/inicial = ${c.externo() / e0}`);
    let mn = 9, mx = 0; const W = 80;
    for (let i = 0; i < W * 60; i++) { const x = i % W, y = (i / W) | 0; if (!(x >= 3 && x <= 76 && y >= 3 && y <= 56)) { const r = soma(c.s, i); mn = Math.min(mn, r); mx = Math.max(mx, r); } }
    assert.ok(mn > 0.99 && mx < 1.01, `densidade externa fugiu de 1: ${mn}..${mx}`);
});

test('Poiseuille: entre duas paredes sólidas o perfil é parabólico (não-deslizamento correto)', () => {
    const W = 220, H = 32, y0 = 4, y1 = 27, s = new FluidSolver(W, H); s.initFluid(0.02);
    for (let x = 0; x < W; x++) { s.setCell(x, y0, CT.BARRIER); s.setCell(x, y1, CT.BARRIER); }
    step(s, 14000, 0.02, 0.1);
    const ys = []; for (let y = y0 + 1; y < y1; y++) ys.push(y);
    const u = ys.map(y => s.ux[170 + y * W]), mean = u.reduce((a, b) => a + b, 0) / u.length;
    // Bounce-back: a parede fica a MEIA célula do nó de fluido mais próximo.
    const yw0 = y0 + 0.5, hh = (y1 - 0.5) - yw0;
    const desvio = Math.max(...u.map((v, k) => { const t = (ys[k] - yw0) / hh; return Math.abs(v - 6 * mean * t * (1 - t)); })) / mean;
    assert.ok(Math.abs(Math.max(...u) / mean - 1.5) < 0.03, `u_centro/u_médio = ${Math.max(...u) / mean} (teórico 1,5)`);
    assert.ok(desvio < 0.03, `desvio do perfil parabólico = ${desvio * 100}%`);
});
