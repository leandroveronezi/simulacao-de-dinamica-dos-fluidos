// Testes de Grade, partículas, Saída e Rotor. Rodar: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { FluidSolver } from '../js/FluidSolver.js';

const CT = FluidSolver.CELL_TYPE;
const VISC = 0.02;

function run(s, steps, u0 = 0.1) {
    for (let i = 0; i < steps; i++) s.step({ u0, viscosity: VISC, moveTracers: false });
}
function ativas(s) {
    return s.particles.filter(p => p.x >= 0);
}
// Grade vertical em x, cobrindo todo o canal (sem vão nas pontas).
function colunaDeGrade(s, x, hole) {
    for (let y = 0; y < s.ydim; y++) {
        s.setCell(x, y, CT.MESH);
        s.meshHoleSize[x + y * s.xdim] = hole;
    }
}

test('Grade não bloqueia o fluido: o vento atravessa', () => {
    const s = new FluidSolver(80, 40);
    s.initFluid(0.1);
    colunaDeGrade(s, 40, 0.3);
    run(s, 600);
    assert.ok(s.checkStability());
    assert.ok(s.ux[20 * s.xdim + 60] > 0.02, `ux depois da grade = ${s.ux[20 * s.xdim + 60]}`);
});

for (const [weight, nome] of [[0, 'leve'], [0.5, 'média'], [1, 'pesada']]) {
    test(`Grade com furo pequeno segura partícula ${nome} contra o vento`, () => {
        const s = new FluidSolver(80, 40);
        s.initFluid(0.1);
        colunaDeGrade(s, 40, 0.1);
        // Larga a partícula antes da grade; o vento a empurra contra ela.
        s.addParticle(34, 20, weight, 'ball');
        run(s, 1500);
        const p = ativas(s)[0];
        assert.ok(p, 'a partícula saiu da cena');
        assert.ok(p.x < 40, `atravessou a grade: x = ${p.x}`);
    });
}

test('Grade com furo grande deixa a partícula passar', () => {
    const s = new FluidSolver(80, 40);
    s.initFluid(0.1);
    colunaDeGrade(s, 40, 2);
    s.addParticle(34, 20, 0.5, 'ball');
    run(s, 1500);
    const p = ativas(s)[0];
    assert.ok(!p || p.x > 40, `ficou presa em x = ${p && p.x}`);
});

test('partícula pesada cai e assenta no chão (y ~ 0) sem NaN', () => {
    const s = new FluidSolver(80, 40);
    s.initFluid(0);
    s.addParticle(40, 10, 1, 'box');
    run(s, 1500, 0);
    const p = ativas(s)[0];
    assert.ok(p);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    // O chão do mundo é y = 0: a partícula parte de y = 10 e deve parar apoiada nele.
    assert.ok(p.y >= 0 && p.y < 2, `y = ${p.y}`);
    assert.ok(Math.abs(p.vy) < 0.01, `ainda em movimento: vy = ${p.vy}`);
});

test('pool de partículas: addParticle falha quando está cheio', () => {
    const s = new FluidSolver(80, 40);
    let ok = 0;
    for (let i = 0; i < FluidSolver.MAX_PARTICLES + 5; i++) if (s.addParticle(40, 20, 0.5, 'ball')) ok++;
    assert.equal(ok, FluidSolver.MAX_PARTICLES);
});

test('Saída drena: massa total cai em relação ao mesmo cenário sem Saída', () => {
    const massa = (comSaida) => {
        const s = new FluidSolver(80, 40);
        s.initFluid(0.1);
        if (comSaida) {
            for (let y = 15; y < 25; y++) for (let x = 40; x < 44; x++) {
                s.setCell(x, y, CT.SINK);
                s.sinkStrength[x + y * s.xdim] = 0.1;
            }
        }
        run(s, 400);
        let m = 0;
        for (const r of s.rho) m += r;
        return m;
    };
    assert.ok(massa(true) < massa(false), 'a Saída não removeu massa');
});

test('Rotor numa corrente gira e se alinha com o vento, estável', () => {
    const s = new FluidSolver(80, 40);
    s.initFluid(0.1);
    // Pá vertical com pivô deslocado: o vento gera torque.
    const cells = [];
    for (let y = 14; y <= 20; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, { x: 40, y: 14 }, { damping: 0.02 });
    s.stampRotatingBodiesOntoGrid();
    run(s, 1500);
    assert.ok(s.checkStability());
    // A pá parte na vertical (ortogonal ao vento) e gira até alinhar com ele (~90°),
    // onde assenta; por isso o que se verifica é o ângulo, não o omega final (~0).
    const b = s.rotatingBodies[0];
    assert.ok(Math.abs(b.angle) > 1, `angle = ${b.angle}`);
    assert.ok(Math.abs(b.omega) < 0.01, `ainda girando rápido: omega = ${b.omega}`);
});

test('Rotor com motor ligado gira mesmo sem vento, e desligado não', () => {
    const omegaFinal = (dir) => {
        const s = new FluidSolver(80, 40);
        s.initFluid(0);
        const cells = [];
        for (let y = 14; y <= 26; y++) cells.push({ x: 40, y });
        s.addRotatingBody(cells, null, { motorDirection: dir, motorSpeed: 0.5 });
        s.stampRotatingBodiesOntoGrid();
        run(s, 800, 0);
        return s.rotatingBodies[0].omega;
    };
    assert.ok(Math.abs(omegaFinal(1)) > 1e-3, 'motor ligado não girou');
    assert.ok(Math.abs(omegaFinal(0)) < 1e-6, 'motor desligado girou sozinho');
});

test('traçador que nasce dentro de um obstáculo é reciclado no primeiro passo', () => {
    // Fluido em repouso: o traçador não se move sozinho, então só a regra de reciclagem o tira
    // do sólido (com vento ele "sairia" empurrado, e o teste não distinguiria nada).
    const s = new FluidSolver(160, 80); s.boundaryMode = 'open'; s.initFluid(0); s.initTracers(true);
    for (let y = 30; y < 50; y++) for (let x = 60; x < 66; x++) s.setCell(x, y, CT.BARRIER);
    const dentro = () => { let n = 0; for (let t = 0; t < s.tracerX.length; t++) if (s._isSolidAtPoint(s.tracerX[t], s.tracerY[t])) n++; return n; };
    assert.ok(dentro() > 0, 'o cenário precisa ter traçadores dentro do sólido');
    for (let i = 0; i < 3; i++) s.step({ u0: 0, viscosity: VISC, moveTracers: true });
    assert.equal(dentro(), 0);
});

function motorComPartículas() {
    const s = new FluidSolver(80, 60); s.boundaryMode = 'open'; s.initFluid(0);
    const cells = []; for (let y = 20; y <= 40; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, null, { motorDirection: 1, motorSpeed: 1, damping: 0.02 }); s.stampRotatingBodiesOntoGrid();
    for (const [x, y] of [[44.5, 38.5], [47.5, 30.5], [36.5, 25.5], [50.5, 30.5]]) s.addParticle(x, y, 0.5, 'ball');
    return s;
}

test('pá em movimento nunca deixa uma partícula com o centro dentro do Rotor por mais de um passo', () => {
    const s = motorComPartículas();
    let seguidos = 0, maxSeguidos = 0;
    for (let i = 0; i < 4000; i++) {
        s.step({ u0: 0, viscosity: VISC, moveTracers: false });
        const dentro = s.particles.some(p => p.x >= 0 && s.cellType[Math.floor(p.x) + Math.floor(p.y) * s.xdim] === CT.ROTOR);
        seguidos = dentro ? seguidos + 1 : 0; maxSeguidos = Math.max(maxSeguidos, seguidos);
    }
    assert.ok(maxSeguidos <= 1, `partícula presa dentro do Rotor por ${maxSeguidos} passos seguidos`);
});

test('a pá empurra a partícula: ela ganha velocidade da própria pá, não só do fluido', () => {
    const s = new FluidSolver(80, 60); s.boundaryMode = 'open'; s.initFluid(0);
    const cells = []; for (let y = 20; y <= 40; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, null, { motorDirection: 1, motorSpeed: 1, damping: 0.02 }); s.stampRotatingBodiesOntoGrid();
    // Fluido congelado em zero a cada passo: só a colisão com a pá pode dar velocidade à partícula.
    s.addParticle(40.5, 38.5, 1, 'ball');
    let vmax = 0;
    for (let i = 0; i < 1500; i++) {
        s.step({ u0: 0, viscosity: VISC, moveTracers: false });
        s.ux.fill(0); s.uy.fill(0);
        const p = s.particles.find(q => q.x >= 0);
        if (p) vmax = Math.max(vmax, Math.abs(p.vx));
    }
    assert.ok(vmax > 0.01, `a partícula nunca passou de ${vmax} de velocidade horizontal`);
});

test('traçadores NÃO nascem em sólidos: nem na criação, nem ao reentrar pela borda', () => {
    const s = new FluidSolver(160, 80); s.boundaryMode = 'open'; s.initFluid(0);
    for (let y = 30; y < 50; y++) for (let x = 60; x < 66; x++) s.setCell(x, y, CT.BARRIER);
    for (let k = 0; k < 25; k++) { s.setCell(100 + k, 10 + k, CT.BARRIER); s.setCell(101 + k, 10 + k, CT.BARRIER); }
    const dentro = () => { let n = 0; for (let t = 0; t < s.tracerX.length; t++) if (s._isSolidAtPoint(s.tracerX[t], s.tracerY[t])) n++; return n; };
    s.initTracers(true);
    assert.equal(dentro(), 0, 'nasceu traçador dentro de sólido na criação');
    // Coluna de entrada quase toda bloqueada: o y sorteado deve cair no trecho livre.
    for (let y = 0; y < 80; y++) if (y < 20 || y >= 30) s.setCell(0, y, CT.BARRIER);
    for (let i = 0; i < 200; i++) assert.ok(s._isFreeForTracer(0, s._randomFreeEntryY()), 'reentrou em sólido');
});

// ---- Traçadores e fumaça são "partículas visíveis sem massa": obedecem ao mesmo ambiente. ----

test('Mundo Aberto: nenhum traçador de fluxo se perde fora do domínio', () => {
    const s = new FluidSolver(100, 60); s.boundaryMode = 'open'; s.initFluid(0); s.initTracers(true);
    const src = []; for (let x = 20; x <= 80; x++) src.push({ x, y: 5 });
    s.addSourceGroup(src, 0, 0.08); for (const c of src) s.setCell(c.x, c.y, CT.SOURCE);
    for (let i = 0; i < 2500; i++) s.step({ u0: 0, viscosity: VISC, moveTracers: true });
    let fora = 0;
    for (let t = 0; t < s.tracerX.length; t++) if (s.tracerX[t] < 0 || s.tracerX[t] > 99 || s.tracerY[t] < 0 || s.tracerY[t] > 59) fora++;
    assert.equal(fora, 0, `${fora} traçadores fora do domínio`);
});

test('velocidade amostrada: Barreira é parede parada e o Rotor leva a velocidade da própria pá', () => {
    const s = new FluidSolver(60, 40); s.boundaryMode = 'open'; s.initFluid(0);
    s.setCell(10, 10, CT.BARRIER);
    s.ux.fill(0.05);
    let v = s._sampleVelocity(10.5, 10.5);
    assert.ok(v[0] < 0.05 * 0.8, `junto da barreira a velocidade deveria cair: ${v[0]}`);
    const cells = []; for (let y = 15; y <= 25; y++) cells.push({ x: 30, y });
    s.addRotatingBody(cells, null, { motorDirection: 1, motorSpeed: 1 }); s.stampRotatingBodiesOntoGrid();
    const b = s.rotatingBodies[0]; b.omega = 0.05;
    for (const c of b.currentCells) { s.rotorWallVx[c.x + c.y * 60] = -b.omega * (c.y - b.pivotY); s.rotorWallVy[c.x + c.y * 60] = b.omega * (c.x - b.pivotX); }
    const topo = { x: 30, y: 25 };
    v = s._sampleVelocity(topo.x, topo.y); // exatamente no canto da célula do rotor: peso 1
    assert.ok(Math.abs(v[0] - s.rotorWallVx[topo.x + topo.y * 60]) < 1e-9, `vx = ${v[0]} vs parede ${s.rotorWallVx[topo.x + topo.y * 60]}`);
});

test('pá empurra a fumaça: com o fluido congelado, só o contato a move, sem sumir nem ficar presa', () => {
    const s = new FluidSolver(80, 60); s.boundaryMode = 'open'; s.initFluid(0);
    const cells = []; for (let y = 20; y <= 40; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, null, { motorDirection: 1, motorSpeed: 1, damping: 0.02 }); s.stampRotatingBodiesOntoGrid();
    // Sem fonte de fumaça: reciclar apagaria o ponto (x = -1), então "continuar ativo" prova que
    // ele foi empurrado e não reciclado.
    s.dyeTracers[0].x = 43.5; s.dyeTracers[0].y = 38.5;
    const inicio = { x: 43.5, y: 38.5 }; let preso = 0, maxPreso = 0, deslocMax = 0;
    for (let i = 0; i < 2500; i++) {
        s.step({ u0: 0, viscosity: VISC, moveTracers: false });
        s.ux.fill(0); s.uy.fill(0);
        const t = s.dyeTracers[0];
        assert.ok(t.x >= 0, `a fumaça foi reciclada/apagada no passo ${i}`);
        preso = s._isSolidAtPoint(t.x, t.y) ? preso + 1 : 0; maxPreso = Math.max(maxPreso, preso);
        deslocMax = Math.max(deslocMax, Math.hypot(t.x - inicio.x, t.y - inicio.y));
    }
    assert.ok(maxPreso <= 1, `fumaça dentro do sólido por ${maxPreso} passos seguidos`);
    assert.ok(deslocMax > 1.5, `a pá não moveu a fumaça (deslocamento máx = ${deslocMax})`);
});

test('traçador de fluxo também é empurrado pela pá (e não reciclado na entrada)', () => {
    const s = new FluidSolver(80, 60); s.boundaryMode = 'open'; s.initFluid(0); s.initTracers(false);
    const cells = []; for (let y = 20; y <= 40; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, null, { motorDirection: 1, motorSpeed: 1, damping: 0.02 }); s.stampRotatingBodiesOntoGrid();
    s.tracerX[0] = 43.5; s.tracerY[0] = 38.5;
    let reciclado = false, deslocMax = 0;
    for (let i = 0; i < 2500; i++) {
        s.step({ u0: 0, viscosity: VISC, moveTracers: true });
        s.ux.fill(0); s.uy.fill(0);
        if (s.tracerX[0] < 5 && Math.abs(s.tracerX[0] - 43.5) > 30) reciclado = true;
        deslocMax = Math.max(deslocMax, Math.hypot(s.tracerX[0] - 43.5, s.tracerY[0] - 38.5));
    }
    assert.equal(reciclado, false, 'o traçador foi reciclado na borda de entrada');
    assert.ok(deslocMax > 1.5, `deslocamento máx = ${deslocMax}`);
});

test('no canal, topo e fundo refletem o ponto sem massa; no Mundo Aberto ele é reciclado', () => {
    const s = new FluidSolver(60, 40); s.initFluid(0);
    let r = s._resolveMasslessStep(20, 38.8, 0, 0.6);
    assert.equal(r.action, 'move'); assert.ok(r.y <= 39 && r.y >= 0, `y = ${r.y}`);
    r = s._resolveMasslessStep(20, 0.3, 0, -0.6);
    assert.equal(r.action, 'move'); assert.ok(r.y >= 0 && r.y <= 39, `y = ${r.y}`);
    s.boundaryMode = 'open';
    assert.equal(s._resolveMasslessStep(20, 38.8, 0, 0.6).action, 'recycle');
    assert.equal(s._resolveMasslessStep(0.2, 20, -0.5, 0).action, 'recycle');
});

function rotorParado() {
    const s = new FluidSolver(80, 60); s.boundaryMode = 'open'; s.initFluid(0);
    const cells = []; for (let y = 20; y <= 40; y++) cells.push({ x: 40, y });
    s.addRotatingBody(cells, null, {}); s.stampRotatingBodiesOntoGrid();
    return s;
}

test('fumaça alcançada pela pá é empurrada para fora no mesmo passo (não fica dentro nem é apagada)', () => {
    const s = rotorParado();
    s.dyeTracers[0].x = 40.5; s.dyeTracers[0].y = 30.5; // dentro de uma célula do Rotor
    assert.ok(s._isSolidAtPoint(40.5, 30.5));
    s.moveDyeTracers();
    const t = s.dyeTracers[0];
    assert.ok(t.x >= 0, 'a fumaça foi apagada');
    assert.equal(s._isSolidAtPoint(t.x, t.y), false, `continua dentro do sólido em (${t.x}, ${t.y})`);
    assert.ok(Math.hypot(t.x - 40.5, t.y - 30.5) < 3, 'foi parar longe demais (teletransporte)');
});

test('traçador de fluxo alcançado pela pá é empurrado para fora no mesmo passo', () => {
    const s = rotorParado(); s.initTracers(false);
    s.tracerX[0] = 40.5; s.tracerY[0] = 30.5;
    s.moveTracers();
    assert.equal(s._isSolidAtPoint(s.tracerX[0], s.tracerY[0]), false);
    assert.ok(Math.hypot(s.tracerX[0] - 40.5, s.tracerY[0] - 30.5) < 3, 'foi parar longe demais (teletransporte)');
});

test('o ponto ejetado leva a velocidade da superfície da pá', () => {
    const s = rotorParado(); const b = s.rotatingBodies[0];
    b.omega = 0.05;
    for (const c of b.currentCells) { s.rotorWallVx[c.x + c.y * 80] = -b.omega * (c.y - b.pivotY); s.rotorWallVy[c.x + c.y * 80] = b.omega * (c.x - b.pivotX); }
    // Acima do pivô (r_y = 8) com ω > 0, a superfície se move em -x com v = ω·r = 0,4 (v = ω × r).
    const r = s._resolveMasslessStep(40.5, 38.5, 0, 0);
    assert.equal(r.action, 'move');
    const livre = s._nearestFreePoint(40.5, 38.5);
    assert.ok(Math.abs((r.x - livre.x) - (-0.4)) < 1e-4, `dx = ${r.x - livre.x}, esperado -0,4 (velocidade da pá)`);
    assert.ok(Math.abs(r.y - livre.y) < 1e-4, `dy = ${r.y - livre.y}`);
});

test('Saída grande (60x40, sucção padrão) não instabiliza o escoamento em 6500 passos', () => {
    // Antes do limite de vazão da sucção, esta cena entrava em instabilidade em ~5700 passos:
    // o ralo esvaziava a região e o gradiente de pressão acelerava o fluido acima do limite de
    // validade do método (|u| ~ 0,3).
    const s = new FluidSolver(211, 147); s.boundaryMode = 'open'; s.initFluid(0);
    for (let y = 60; y < 100; y++) for (let x = 80; x < 140; x++) s.setCell(x, y, CT.SINK);
    const aviso = console.warn; console.warn = () => {};
    try {
        for (let i = 0; i < 6500; i++) {
            s.step({ u0: 0, viscosity: VISC, moveTracers: false });
            if (i % 250 === 0) assert.ok(s.checkStability(), `instável no passo ${i} (limitador em ${s._clampedCellCount} células)`);
        }
        assert.ok(s.checkStability(), 'instável ao final');
    } finally { console.warn = aviso; }
});

test('rotores sobrepostos não abrem buracos de um passo', () => {
    const s = new FluidSolver(80, 50); s.boundaryMode = 'open'; s.initFluid(0);
    const pa = [], pb = [];
    for (let x = 31; x <= 47; x++) pa.push({ x, y: 25 });
    for (let x = 34; x <= 44; x++) pb.push({ x, y: 25 });
    s.addRotatingBody(pa, { x: 39, y: 25 }, { motorDirection: 1, motorSpeed: 1 });
    s.addRotatingBody(pb, { x: 39, y: 25 }, { motorDirection: -1, motorSpeed: 0.2 });
    s.stampRotatingBodiesOntoGrid();
    let buracos = 0;
    for (let k = 0; k < 1500; k++) {
        s.step({ u0: 0, viscosity: 0.02, moveTracers: false });
        for (const b of s.rotatingBodies) for (const { x, y } of b.currentCells) if (s.cellType[x + y * s.xdim] !== FluidSolver.CELL_TYPE.ROTOR) buracos++;
    }
    assert.equal(buracos, 0);
});

test('partícula dentro de uma Barreira é levada para fora; NaN na viscosidade não contamina a grade', () => {
    const s = new FluidSolver(60, 40); s.boundaryMode = 'open'; s.initFluid(0);
    for (let x = 20; x < 30; x++) for (let y = 10; y < 20; y++) s.setCell(x, y, FluidSolver.CELL_TYPE.BARRIER);
    s.addParticle(25, 15, 0.5, 'ball');
    for (let k = 0; k < 20; k++) s.step({ u0: 0, viscosity: NaN, moveTracers: false });
    const p = s.particles.find(q => q.x >= 0);
    assert.ok(!p || s._isFreeForTracer(p.x, p.y), 'a partícula continua dentro da barreira');
    assert.ok(s.checkStability(), 'viscosidade NaN contaminou a grade');
});

test('Mundo Aberto: partículas saem por qualquer borda; no Canal, topo e fundo são paredes', () => {
    const sai = (modo, x, y, vx, vy) => {
        const s = new FluidSolver(60, 40); s.boundaryMode = modo; s.initFluid(0);
        s.addParticle(x, y, 0.5, 'ball'); const p = s.particles.find(q => q.x >= 0); p.vx = vx; p.vy = vy;
        for (let k = 0; k < 200; k++) s.step({ u0: 0, viscosity: 0.02, moveTracers: false });
        return !s.particles.some(q => q.x >= 0);
    };
    for (const [x, y, vx, vy] of [[1.2, 20, -0.3, 0], [30, 38.3, 0, 0.3], [30, 1.2, 0, -0.3]]) {
        assert.equal(sai('open', x, y, vx, vy), true, `open ${x},${y}`);
        assert.equal(sai('channel', x, y, vx, vy), false, `channel ${x},${y}`);
    }
});

// A borda aberta que só copiava o vizinho deixava a pressão à deriva: estas cenas instabilizavam
// em 2400-6800 passos. Com a densidade da borda relaxada para 1 (OPEN_BOUNDARY_PRESSURE_RELAX) ficam estáveis.
test('Mundo Aberto: Entrada + Saída em grade pequena e viscosidade baixa seguem estáveis', () => {
    const cena = (w, h, x0, x1, y0, y1, nu, passos) => {
        const s = new FluidSolver(w, h); s.boundaryMode = 'open'; s.initFluid(0);
        const g = []; for (let y = y0; y < y1; y++) g.push({ x: 3, y });
        s.addSourceGroup(g, 0.1, 0); for (const c of g) s.setCell(c.x, c.y, CT.SOURCE);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s.setCell(x, y, CT.SINK);
        const aviso = console.warn; console.warn = () => {};
        try {
            for (let i = 0; i < passos; i++) {
                s.step({ u0: 0, viscosity: nu, moveTracers: false });
                if (i % 250 === 0) assert.ok(s.checkStability(), `${w}x${h} ν=${nu} instável no passo ${i}`);
            }
        } finally { console.warn = aviso; }
    };
    cena(40, 40, 34, 38, 15, 25, 0.02, 3500);
    cena(80, 40, 74, 78, 10, 30, 0.008, 3000);
});
