/**
 * @class FluidSolver
 * @description Motor de física da simulação de dinâmica dos fluidos (Lattice-Boltzmann, D2Q9).
 * Não possui nenhuma referência a DOM/canvas — apenas estado numérico e as regras do LBM.
 */
export class FluidSolver {
    static CELL_TYPE = Object.freeze({
        NORMAL: 0,
        BARRIER: 1,
        SOURCE: 2,
        SINK: 3
    });

    static N_TRACERS = 144;
    static MAX_DYE_TRACERS = 4000;
    static PARTICLES_PER_FRAME_EMISSION = 10;
    static SINK_RAMP_CELLS = 8;
    static SINK_MAX_DAMPING = 0.9;
    static SINK_TARGET_RHO = 0.97;

    constructor(xdim, ydim) {
        // Pesos do modelo LBM D2Q9
        this.FOUR_NINTHS = 4.0 / 9.0;
        this.ONE_NINTH = 1.0 / 9.0;
        this.ONE_THIRTY_SIXTH = 1.0 / 36.0;

        this.boundaryMode = 'channel'; // 'channel' | 'open'
        this.resize(xdim, ydim);
    }

    /**
     * @description (Re)aloca todos os arrays da simulação para uma nova dimensão de grade.
     */
    resize(xdim, ydim) {
        this.xdim = xdim;
        this.ydim = ydim;
        const size = xdim * ydim;

        // Arrays para as 9 distribuições de partículas (D2Q9)
        this.n0 = new Float32Array(size);
        this.nN = new Float32Array(size);
        this.nS = new Float32Array(size);
        this.nE = new Float32Array(size);
        this.nW = new Float32Array(size);
        this.nNE = new Float32Array(size);
        this.nSE = new Float32Array(size);
        this.nNW = new Float32Array(size);
        this.nSW = new Float32Array(size);

        // Arrays temporários para o passo de propagação
        this.temp_n0 = new Float32Array(size);
        this.temp_nN = new Float32Array(size);
        this.temp_nS = new Float32Array(size);
        this.temp_nE = new Float32Array(size);
        this.temp_nW = new Float32Array(size);
        this.temp_nNE = new Float32Array(size);
        this.temp_nSE = new Float32Array(size);
        this.temp_nNW = new Float32Array(size);
        this.temp_nSW = new Float32Array(size);

        // Arrays para as variáveis macroscópicas
        this.rho = new Float32Array(size).fill(1);
        this.ux = new Float32Array(size);
        this.uy = new Float32Array(size);
        this.curl = new Float32Array(size);

        this.cellType = new Uint8Array(size);
        this.sourceVx = new Float32Array(size);
        this.sourceVy = new Float32Array(size);
        this.sinkDamping = new Float32Array(size);
        this._sinkGeometryDirty = true;
        this.dyeSources = [];

        this.sensorX = Math.round(xdim / 2);
        this.sensorY = Math.round(ydim / 2);

        this.barrierCount = 0;
        this.barrierxSum = 0;
        this.barrierySum = 0;
        this.barrierFx = 0.0;
        this.barrierFy = 0.0;

        this.initTracers(false);
        this.initDyeTracers();
    }

    setCell(x, y, type) {
        if (x >= 0 && x < this.xdim && y >= 0 && y < this.ydim) {
            this.cellType[x + y * this.xdim] = type;
            this._sinkGeometryDirty = true;
            return true;
        }
        return false;
    }

    /**
     * @description Marca a geometria das Saídas como desatualizada, forçando o recálculo do
     * amortecimento em rampa no próximo passo. Chamar sempre que `cellType` for substituído
     * diretamente (undo/redo, importar configuração) sem passar por `setCell`.
     */
    invalidateSinkDamping() {
        this._sinkGeometryDirty = true;
    }

    setEquilibrium(x, y, newux, newuy, newrho) {
        if (x < 0 || x >= this.xdim || y < 0 || y >= this.ydim) return;
        const i = x + y * this.xdim;
        this.rho[i] = newrho;
        this.ux[i] = newux;
        this.uy[i] = newuy;
        const ux3 = 3 * newux,
            uy3 = 3 * newuy;
        const ux2 = newux * newux,
            uy2 = newuy * newuy;
        const uxuy2 = 2 * newux * newuy,
            u2 = ux2 + uy2,
            u215 = 1.5 * u2;
        this.n0[i] = this.FOUR_NINTHS * newrho * (1 - u215);
        this.nE[i] = this.ONE_NINTH * newrho * (1 + ux3 + 4.5 * ux2 - u215);
        this.nW[i] = this.ONE_NINTH * newrho * (1 - ux3 + 4.5 * ux2 - u215);
        this.nN[i] = this.ONE_NINTH * newrho * (1 + uy3 + 4.5 * uy2 - u215);
        this.nS[i] = this.ONE_NINTH * newrho * (1 - uy3 + 4.5 * uy2 - u215);
        this.nNE[i] = this.ONE_THIRTY_SIXTH * newrho * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215);
        this.nSE[i] = this.ONE_THIRTY_SIXTH * newrho * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215);
        this.nNW[i] = this.ONE_THIRTY_SIXTH * newrho * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215);
        this.nSW[i] = this.ONE_THIRTY_SIXTH * newrho * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215);
    }

    initFluid(u0) {
        for (let i = 0; i < this.xdim * this.ydim; i++) {
            this.setEquilibrium(i % this.xdim, Math.floor(i / this.xdim), u0, 0, 1);
        }
    }

    initTracers(enabled) {
        this.tracerX = new Float32Array(FluidSolver.N_TRACERS);
        this.tracerY = new Float32Array(FluidSolver.N_TRACERS);
        if (enabled) {
            const nRows = Math.ceil(Math.sqrt(FluidSolver.N_TRACERS));
            const dx = this.xdim / nRows,
                dy = this.ydim / nRows;
            let nX = dx / 2,
                nY = dy / 2;
            for (let t = 0; t < FluidSolver.N_TRACERS; t++) {
                this.tracerX[t] = nX;
                this.tracerY[t] = nY;
                nX += dx;
                if (nX > this.xdim) {
                    nX = dx / 2;
                    nY += dy;
                }
            }
        }
    }

    initDyeTracers() {
        this.dyeTracers = [];
        for (let i = 0; i < FluidSolver.MAX_DYE_TRACERS; i++) {
            this.dyeTracers.push({
                x: -1,
                y: -1
            });
        }
    }

    /**
     * @description Executa um passo de tempo completo: colisão, propagação, contornos e traçadores.
     * @param {{u0: number, viscosity: number, moveTracers: boolean}} params
     */
    step({
        u0,
        viscosity,
        moveTracers
    }) {
        if (this._sinkGeometryDirty) {
            this._recomputeSinkDamping();
            this._sinkGeometryDirty = false;
        }
        this.collide(viscosity);
        this.stream();
        this.setBoundaries(u0);
        this._applySourcesAndSinks();
        if (moveTracers) this.moveTracers();
        this.moveDyeTracers();
        this._emitNewDyeTracers();
    }

    /**
     * @private
     * @description Calcula, para cada célula SINK, o quão "profunda" ela está dentro da
     * região de Saída (distância em células até a borda mais próxima que não é Saída, via
     * BFS a partir das bordas). Uma Saída fina (1 célula) fica toda na profundidade 1 — pouco
     * amortecimento, quase transparente. Uma Saída grossa tem células mais profundas no meio,
     * com amortecimento crescendo em rampa até `SINK_MAX_DAMPING`. Essa rampa gradual (em vez
     * de um corte abrupto) é o que evita a célula se comportar como um obstáculo que desvia o
     * fluxo, mesmo assim absorvendo energia/massa de verdade em regiões mais espessas.
     */
    _recomputeSinkDamping() {
        const size = this.xdim * this.ydim;
        if (this.sinkDamping.length !== size) {
            this.sinkDamping = new Float32Array(size);
        } else {
            this.sinkDamping.fill(0);
        }

        const depth = new Int32Array(size).fill(-1);
        const queue = [];
        const isSink = (i) => this.cellType[i] === FluidSolver.CELL_TYPE.SINK;

        for (let y = 0; y < this.ydim; y++) {
            for (let x = 0; x < this.xdim; x++) {
                const i = x + y * this.xdim;
                if (!isSink(i)) continue;
                const hasNonSinkNeighbor =
                    x === 0 || x === this.xdim - 1 || y === 0 || y === this.ydim - 1 ||
                    !isSink(i - 1) || !isSink(i + 1) || !isSink(i - this.xdim) || !isSink(i + this.xdim);
                if (hasNonSinkNeighbor) {
                    depth[i] = 1;
                    queue.push(i);
                }
            }
        }

        let qi = 0;
        while (qi < queue.length) {
            const i = queue[qi++];
            const x = i % this.xdim,
                y = Math.floor(i / this.xdim);
            const neighbors = [
                [x - 1, y],
                [x + 1, y],
                [x, y - 1],
                [x, y + 1]
            ];
            for (const [nx, ny] of neighbors) {
                if (nx < 0 || nx >= this.xdim || ny < 0 || ny >= this.ydim) continue;
                const ni = nx + ny * this.xdim;
                if (!isSink(ni) || depth[ni] !== -1) continue;
                depth[ni] = depth[i] + 1;
                queue.push(ni);
            }
        }

        const RAMP = FluidSolver.SINK_RAMP_CELLS;
        const MAX_DAMPING = FluidSolver.SINK_MAX_DAMPING;
        for (let i = 0; i < size; i++) {
            if (depth[i] > 0) {
                this.sinkDamping[i] = Math.min(MAX_DAMPING, (depth[i] / RAMP) * MAX_DAMPING);
            }
        }
    }

    /**
     * @description Define as condições de contorno do domínio de simulação.
     * - Modo 'channel': borda esquerda = entrada com velocidade constante, borda direita =
     *   saída com gradiente zero, bordas superior/inferior = paredes com deslizamento livre.
     * - Modo 'open': as 4 bordas viram saída com gradiente zero — sem entrada/parede fixa.
     *   Quem movimenta o fluido nesse modo são as células SOURCE pintadas pelo usuário.
     */
    setBoundaries(u0) {
        if (this.boundaryMode === 'open') {
            this._applyOpenBoundaries();
            return;
        }

        // Borda de entrada (esquerda)
        for (let y = 0; y < this.ydim; y++) {
            this.setEquilibrium(0, y, u0, 0, 1);
        }

        // Borda de saída (direita)
        for (let y = 0; y < this.ydim; y++) {
            const i = this.xdim - 1 + y * this.xdim;
            const i_prev = this.xdim - 2 + y * this.xdim;
            this.n0[i] = this.n0[i_prev] || 0;
            this.nN[i] = this.nN[i_prev] || 0;
            this.nS[i] = this.nS[i_prev] || 0;
            this.nE[i] = this.nE[i_prev] || 0;
            this.nW[i] = this.nW[i_prev] || 0;
            this.nNE[i] = this.nNE[i_prev] || 0;
            this.nSE[i] = this.nSE[i_prev] || 0;
            this.nNW[i] = this.nNW[i_prev] || 0;
            this.nSW[i] = this.nSW[i_prev] || 0;
        }

        // Bordas superior e inferior (paredes com deslizamento)
        for (let x = 0; x < this.xdim; x++) {
            const i_top = x + (this.ydim - 1) * this.xdim;
            const i_bot = x;
            this.nS[i_top] = this.nN[i_top] || 0;
            this.nSE[i_top] = this.nNW[i_top] || 0;
            this.nSW[i_top] = this.nNE[i_top] || 0;

            this.nN[i_bot] = this.nS[i_bot] || 0;
            this.nNE[i_bot] = this.nSW[i_bot] || 0;
            this.nNW[i_bot] = this.nSE[i_bot] || 0;
        }
    }

    /**
     * @private
     * @description Modo 'open': copia as distribuições do vizinho interno em todas as 4
     * bordas (gradiente zero / saída livre), sem impor nenhuma velocidade de entrada.
     */
    _applyOpenBoundaries() {
        const copyCell = (i, iFrom) => {
            this.n0[i] = this.n0[iFrom] || 0;
            this.nN[i] = this.nN[iFrom] || 0;
            this.nS[i] = this.nS[iFrom] || 0;
            this.nE[i] = this.nE[iFrom] || 0;
            this.nW[i] = this.nW[iFrom] || 0;
            this.nNE[i] = this.nNE[iFrom] || 0;
            this.nSE[i] = this.nSE[iFrom] || 0;
            this.nNW[i] = this.nNW[iFrom] || 0;
            this.nSW[i] = this.nSW[iFrom] || 0;
        };

        for (let y = 0; y < this.ydim; y++) {
            copyCell(y * this.xdim, 1 + y * this.xdim);
            copyCell(this.xdim - 1 + y * this.xdim, this.xdim - 2 + y * this.xdim);
        }
        for (let x = 0; x < this.xdim; x++) {
            copyCell(x, x + this.xdim);
            copyCell(x + (this.ydim - 1) * this.xdim, x + (this.ydim - 2) * this.xdim);
        }
    }

    /**
     * @private
     * @description Impõe a velocidade das células SOURCE (entradas pintadas) e modela as
     * células SINK (saídas) como um poço de baixa pressão: a densidade é puxada em rampa até
     * `SINK_TARGET_RHO`, mas a velocidade local NÃO é tocada. Amortecer a velocidade (versão
     * anterior) faz a célula resistir ao que chega, e qualquer região resistiva que não
     * atravesse o domínio de parede a parede faz o fluxo desviar pelas bordas livres — o mesmo
     * efeito de um obstáculo. Reduzir só a densidade cria um gradiente de pressão real que o
     * próprio `collide()`/`stream()` já usa para puxar o fluido vizinho para dentro (sucção),
     * em vez de empurrá-lo para os lados.
     */
    _applySourcesAndSinks() {
        for (let i = 0; i < this.xdim * this.ydim; i++) {
            if (this.cellType[i] === FluidSolver.CELL_TYPE.SOURCE) {
                const x = i % this.xdim,
                    y = Math.floor(i / this.xdim);
                this.setEquilibrium(x, y, this.sourceVx[i], this.sourceVy[i], 1);
            } else if (this.cellType[i] === FluidSolver.CELL_TYPE.SINK) {
                const damping = this.sinkDamping[i];
                if (damping <= 0) continue;
                const x = i % this.xdim,
                    y = Math.floor(i / this.xdim);
                const newRho = this.rho[i] - (this.rho[i] - FluidSolver.SINK_TARGET_RHO) * damping;
                this.setEquilibrium(x, y, this.ux[i], this.uy[i], newRho);
            }
        }
    }

    /**
     * @description Executa o passo de colisão do algoritmo LBM.
     * 1. Calcula as propriedades macroscópicas (densidade, velocidade).
     * 2. Calcula as distribuições de equilíbrio com base nessas propriedades.
     * 3. Relaxa as distribuições atuais em direção ao equilíbrio.
     */
    collide(viscosity) {
        const omega = Math.max(0.01, Math.min(1.99, 1.0 / (3.0 * viscosity + 0.5))); // Parâmetro de relaxação

        for (let i = 0; i < this.xdim * this.ydim; i++) {
            // 1. Calcula densidade e velocidades macroscópicas
            const thisrho = this.n0[i] + this.nN[i] + this.nS[i] + this.nE[i] + this.nW[i] + this.nNW[i] + this.nNE[i] + this.nSW[i] + this.nSE[i];

            if (thisrho <= 0) { // Checagem de estabilidade
                this.rho[i] = 1;
                this.ux[i] = 0;
                this.uy[i] = 0;
                continue;
            }
            this.rho[i] = thisrho;

            const thisux = (this.nE[i] + this.nNE[i] + this.nSE[i] - this.nW[i] - this.nNW[i] - this.nSW[i]) / thisrho;
            const thisuy = (this.nN[i] + this.nNE[i] + this.nNW[i] - this.nS[i] - this.nSE[i] - this.nSW[i]) / thisrho;
            this.ux[i] = isFinite(thisux) ? thisux : 0;
            this.uy[i] = isFinite(thisuy) ? thisuy : 0;

            // 2. Calcula as distribuições de equilíbrio (f_eq)
            const one9thrho = this.ONE_NINTH * thisrho;
            const one36thrho = this.ONE_THIRTY_SIXTH * thisrho;
            const ux3 = 3 * this.ux[i];
            const uy3 = 3 * this.uy[i];
            const ux2 = this.ux[i] * this.ux[i];
            const uy2 = this.uy[i] * this.uy[i];
            const uxuy2 = 2 * this.ux[i] * this.uy[i];
            const u2 = ux2 + uy2;
            const u215 = 1.5 * u2;

            const eq0 = this.FOUR_NINTHS * thisrho * (1 - u215);
            const eqE = one9thrho * (1 + ux3 + 4.5 * ux2 - u215);
            const eqW = one9thrho * (1 - ux3 + 4.5 * ux2 - u215);
            const eqN = one9thrho * (1 + uy3 + 4.5 * uy2 - u215);
            const eqS = one9thrho * (1 - uy3 + 4.5 * uy2 - u215);
            const eqNE = one36thrho * (1 + ux3 + uy3 + 4.5 * (u2 + uxuy2) - u215);
            const eqSE = one36thrho * (1 + ux3 - uy3 + 4.5 * (u2 - uxuy2) - u215);
            const eqNW = one36thrho * (1 - ux3 + uy3 + 4.5 * (u2 - uxuy2) - u215);
            const eqSW = one36thrho * (1 - ux3 - uy3 + 4.5 * (u2 + uxuy2) - u215);

            // 3. Relaxa as distribuições (colisão)
            this.n0[i] += omega * (eq0 - this.n0[i]);
            this.nE[i] += omega * (eqE - this.nE[i]);
            this.nW[i] += omega * (eqW - this.nW[i]);
            this.nN[i] += omega * (eqN - this.nN[i]);
            this.nS[i] += omega * (eqS - this.nS[i]);
            this.nNE[i] += omega * (eqNE - this.nNE[i]);
            this.nSE[i] += omega * (eqSE - this.nSE[i]);
            this.nNW[i] += omega * (eqNW - this.nNW[i]);
            this.nSW[i] += omega * (eqSW - this.nSW[i]);
        }
    }

    /**
     * @description Executa o passo de propagação (streaming) do algoritmo LBM.
     * As distribuições de partículas movem-se para as células vizinhas.
     * A condição de contorno de obstáculo (bounce-back) é aplicada aqui.
     */
    stream() {
        // Propaga as distribuições para células vizinhas usando arrays temporários
        for (let y = 0; y < this.ydim; y++) {
            for (let x = 0; x < this.xdim; x++) {
                const i = x + y * this.xdim;
                this.temp_n0[i] = this.n0[i];
                this.temp_nE[((x + 1) % this.xdim) + y * this.xdim] = this.nE[i];
                this.temp_nW[((x - 1 + this.xdim) % this.xdim) + y * this.xdim] = this.nW[i];
                this.temp_nN[x + ((y + 1) % this.ydim) * this.xdim] = this.nN[i];
                this.temp_nS[x + ((y - 1 + this.ydim) % this.ydim) * this.xdim] = this.nS[i];
                this.temp_nNE[((x + 1) % this.xdim) + ((y + 1) % this.ydim) * this.xdim] = this.nNE[i];
                this.temp_nSE[((x + 1) % this.xdim) + ((y - 1 + this.ydim) % this.ydim) * this.xdim] = this.nSE[i];
                this.temp_nNW[((x - 1 + this.xdim) % this.xdim) + ((y + 1) % this.ydim) * this.xdim] = this.nNW[i];
                this.temp_nSW[((x - 1 + this.xdim) % this.xdim) + ((y - 1 + this.ydim) % this.ydim) * this.xdim] = this.nSW[i];
            }
        }

        // Troca os arrays principal e temporário de forma eficiente
        [this.n0, this.temp_n0] = [this.temp_n0, this.n0];
        [this.nN, this.temp_nN] = [this.temp_nN, this.nN];
        [this.nS, this.temp_nS] = [this.temp_nS, this.nS];
        [this.nE, this.temp_nE] = [this.temp_nE, this.nE];
        [this.nW, this.temp_nW] = [this.temp_nW, this.nW];
        [this.nNE, this.temp_nNE] = [this.temp_nNE, this.nNE];
        [this.nSE, this.temp_nSE] = [this.temp_nSE, this.nSE];
        [this.nNW, this.temp_nNW] = [this.temp_nNW, this.nNW];
        [this.nSW, this.temp_nSW] = [this.temp_nSW, this.nSW];

        // Aplica a condição de contorno de obstáculo (bounce-back) e calcula forças
        this.barrierCount = 0;
        this.barrierxSum = 0;
        this.barrierySum = 0;
        this.barrierFx = 0.0;
        this.barrierFy = 0.0;

        for (let i = 0; i < this.xdim * this.ydim; i++) {
            if (this.cellType[i] === FluidSolver.CELL_TYPE.BARRIER) {
                const x = i % this.xdim,
                    y = Math.floor(i / this.xdim);
                // Inverte as direções das distribuições que chegaram à barreira
                [this.nE[i], this.nW[i]] = [this.nW[i], this.nE[i]];
                [this.nN[i], this.nS[i]] = [this.nS[i], this.nN[i]];
                [this.nNE[i], this.nSW[i]] = [this.nSW[i], this.nNE[i]];
                [this.nNW[i], this.nSE[i]] = [this.nSE[i], this.nNW[i]];

                // Calcula a força total exercida pelo fluido sobre as barreiras
                this.barrierCount++;
                this.barrierxSum += x;
                this.barrierySum += y;
                this.barrierFx += 2 * (this.nE[i] + this.nNE[i] + this.nSE[i] - this.nW[i] - this.nNW[i] - this.nSW[i]);
                this.barrierFy += 2 * (this.nN[i] + this.nNE[i] + this.nNW[i] - this.nS[i] - this.nSE[i] - this.nSW[i]);
            }
        }
    }

    computeCurl() {
        for (let y = 1; y < this.ydim - 1; y++) {
            for (let x = 1; x < this.xdim - 1; x++) {
                this.curl[x + y * this.xdim] = this.uy[x + 1 + y * this.xdim] - this.uy[x - 1 + y * this.xdim] - this.ux[x + (y + 1) * this.xdim] + this.ux[x + (y - 1) * this.xdim];
            }
        }
        for (let x = 0; x < this.xdim; x++) {
            this.curl[x] = 0;
            this.curl[x + (this.ydim - 1) * this.xdim] = 0;
        }
        for (let y = 0; y < this.ydim; y++) {
            this.curl[y * this.xdim] = 0;
            this.curl[this.xdim - 1 + y * this.xdim] = 0;
        }
    }

    checkStability() {
        for (let i = 0; i < this.rho.length; i++) {
            if (this.rho[i] <= 0 || !isFinite(this.rho[i]) || !isFinite(this.ux[i]) || !isFinite(this.uy[i]) || Math.abs(this.ux[i]) > 0.5 || Math.abs(this.uy[i]) > 0.5) {
                console.warn('Instabilidade detectada na célula:', i, {
                    rho: this.rho[i],
                    ux: this.ux[i],
                    uy: this.uy[i]
                });
                return false;
            }
        }
        return true;
    }

    _bilinearInterpolate(x, y, grid) {
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        if (x0 < 0 || y0 < 0 || x1 >= this.xdim || y1 >= this.ydim) {
            const clampedX = Math.max(0, Math.min(this.xdim - 1, Math.round(x)));
            const clampedY = Math.max(0, Math.min(this.ydim - 1, Math.round(y)));
            return grid[clampedX + clampedY * this.xdim];
        }

        const v00 = grid[x0 + y0 * this.xdim];
        const v01 = grid[x0 + y1 * this.xdim];
        const v10 = grid[x1 + y0 * this.xdim];
        const v11 = grid[x1 + y1 * this.xdim];
        const wx = x - x0;
        const wy = y - y0;
        return v00 * (1 - wx) * (1 - wy) + v10 * wx * (1 - wy) + v01 * (1 - wx) * wy + v11 * wx * wy;
    }

    moveTracers() {
        if (!this.tracerX) return;
        for (let t = 0; t < FluidSolver.N_TRACERS; t++) {
            const ux_interp = this._bilinearInterpolate(this.tracerX[t], this.tracerY[t], this.ux);
            const uy_interp = this._bilinearInterpolate(this.tracerX[t], this.tracerY[t], this.uy);
            if (!isFinite(ux_interp) || !isFinite(uy_interp)) continue;
            this.tracerX[t] += ux_interp;
            this.tracerY[t] += uy_interp;
            const rx = Math.floor(this.tracerX[t]);
            const ry = Math.floor(this.tracerY[t]);
            const hitsObstacle = rx >= 0 && rx < this.xdim && ry >= 0 && ry < this.ydim &&
                (this.cellType[rx + ry * this.xdim] === FluidSolver.CELL_TYPE.BARRIER || this.cellType[rx + ry * this.xdim] === FluidSolver.CELL_TYPE.SINK);
            if (this.tracerX[t] > this.xdim - 1 || hitsObstacle) {
                this.tracerX[t] = 0;
                this.tracerY[t] = Math.random() * this.ydim;
            }
        }
    }

    _emitNewDyeTracers() {
        const activeSources = this.dyeSources.filter(source => {
            const ix = Math.floor(source.x),
                iy = Math.floor(source.y);
            return ix >= 0 && ix < this.xdim && iy >= 0 && iy < this.ydim && this.cellType[ix + iy * this.xdim] !== FluidSolver.CELL_TYPE.BARRIER;
        });
        if (activeSources.length === 0) return;
        const activeTracers = this.dyeTracers.filter(t => t.x >= 0).length;
        const availableSlots = FluidSolver.MAX_DYE_TRACERS - activeTracers;
        if (availableSlots <= 0) return;
        const particlesToEmit = Math.min(FluidSolver.PARTICLES_PER_FRAME_EMISSION, availableSlots);
        for (let i = 0; i < particlesToEmit; i++) {
            const inactiveTracer = this.dyeTracers.find(t => t.x < 0);
            if (inactiveTracer) {
                const source = activeSources[Math.floor(Math.random() * activeSources.length)];
                inactiveTracer.x = source.x + (Math.random() - 0.5) * 0.5;
                inactiveTracer.y = source.y + (Math.random() - 0.5) * 0.5;
            } else {
                break;
            }
        }
    }

    _recycleDyeTracer(tracer) {
        const activeSources = this.dyeSources.filter(source => {
            const ix = Math.floor(source.x),
                iy = Math.floor(source.y);
            return ix >= 0 && ix < this.xdim && iy >= 0 && iy < this.ydim && this.cellType[ix + iy * this.xdim] !== FluidSolver.CELL_TYPE.BARRIER;
        });
        if (activeSources.length > 0) {
            const source = activeSources[Math.floor(Math.random() * activeSources.length)];
            tracer.x = source.x + (Math.random() - 0.5) * 0.5;
            tracer.y = source.y + (Math.random() - 0.5) * 0.5;
        } else {
            tracer.x = -1;
            tracer.y = -1;
        }
    }

    moveDyeTracers() {
        for (const tracer of this.dyeTracers) {
            if (tracer.x < 0) continue;
            const ux_interp = this._bilinearInterpolate(tracer.x, tracer.y, this.ux);
            const uy_interp = this._bilinearInterpolate(tracer.x, tracer.y, this.uy);
            if (!isFinite(ux_interp) || !isFinite(uy_interp)) {
                this._recycleDyeTracer(tracer);
                continue;
            }
            tracer.x += ux_interp;
            tracer.y += uy_interp;
            const rx = Math.floor(tracer.x);
            const ry = Math.floor(tracer.y);
            if (rx < 0 || rx >= this.xdim || ry < 0 || ry >= this.ydim) {
                this._recycleDyeTracer(tracer);
                continue;
            }
            const cellType = this.cellType[rx + ry * this.xdim];
            if (cellType === FluidSolver.CELL_TYPE.BARRIER || cellType === FluidSolver.CELL_TYPE.SINK) {
                this._recycleDyeTracer(tracer);
            }
        }
    }
}
