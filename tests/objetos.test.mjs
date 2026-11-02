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
    assert.ok(vmax > 0.02, `a partícula nunca passou de ${vmax} de velocidade horizontal`);
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
