// Tamanho da grade do FluidSimulationApp: campos de largura/altura, dica de custo e aplicação.
// Extraído de FluidSimulationApp.js; os métodos são anexados ao protótipo do app por applyMixin,
// então `this` é a instância do app.

import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20260908d';

export class GridSize {
    /**
     * @private
     * @description Sincroniza os campos de tamanho da grade com as dimensões que a simulação
     * REALMENTE tem agora — chamado depois de qualquer coisa que recrie a grade (novo cenário,
     * importar configuração, restaurar auto-save), para os campos nunca mostrarem um tamanho que
     * não é o da cena na tela.
     */
    _syncGridSizeInputs() {
        if (!this.gridWidthInput || !this.solver) return;
        this.gridWidthInput.value = this.solver.xdim;
        this.gridHeightInput.value = this.solver.ydim;
        this._updateGridSizeHint();
    }

    /**
     * @private
     * @description Atualiza a linha de dica embaixo dos campos: quanto a grade digitada tem de
     * células e, quando for grande o bastante para pesar, um aviso. Mostra também o tamanho
     * atual quando o valor digitado ainda não foi aplicado, para ficar claro que o campo é uma
     * intenção, não o estado da simulação.
     */
    _updateGridSizeHint() {
        if (!this.gridSizeHint || !this.solver) return;
        const w = Number(this.gridWidthInput.value);
        const h = Number(this.gridHeightInput.value);
        const atual = `Atual: ${this.solver.xdim} × ${this.solver.ydim}`;
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            this.gridSizeHint.textContent = atual;
            this.gridSizeHint.classList.remove('is-heavy');
            return;
        }
        // Valor fora dos limites não vira contagem de células: dizer "38 milhões de células — vai
        // rodar lento" para um tamanho que o Aplicar vai recusar de qualquer jeito é pior que não
        // dizer nada, porque descreve como lento algo que é impossível.
        const MIN = FluidSimulationApp.GRID_MIN_DIM,
            MAX = FluidSimulationApp.GRID_MAX_DIM;
        if (w < MIN || h < MIN || w > MAX || h > MAX) {
            this.gridSizeHint.textContent = `Cada lado precisa estar entre ${MIN} e ${MAX} · ${atual.toLowerCase()}`;
            this.gridSizeHint.classList.add('is-heavy');
            return;
        }
        const area = Math.round(w) * Math.round(h);
        const pendente = Math.round(w) !== this.solver.xdim || Math.round(h) !== this.solver.ydim;
        const celulas = area >= 1000 ? `${(area / 1000).toFixed(0)} mil células` : `${area} células`;
        const pesada = area > FluidSimulationApp.GRID_HEAVY_AREA;
        this.gridSizeHint.textContent = pendente
            ? `${celulas}${pesada ? ' — vai rodar lento' : ''} · ${atual.toLowerCase()}`
            : `${atual} (${celulas})`;
        this.gridSizeHint.classList.toggle('is-heavy', pendente && pesada);
    }

    /**
     * @private
     * @description Aplica um novo tamanho de grade (bugs.md #49). Recriar a grade recria todos
     * os arrays do solver, então a cena inteira (formas, rotores, fumaça, desfazer/refazer) vai
     * junto — daí a confirmação, no mesmo padrão do "Limpar tudo".
     */
    async _applyGridSize() {
        const MIN = FluidSimulationApp.GRID_MIN_DIM,
            MAX = FluidSimulationApp.GRID_MAX_DIM;
        const w = Math.round(Number(this.gridWidthInput.value));
        const h = Math.round(Number(this.gridHeightInput.value));
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < MIN || h < MIN || w > MAX || h > MAX) {
            Swal.fire({
                title: 'Tamanho inválido',
                text: `Cada lado da grade precisa estar entre ${MIN} e ${MAX} células.`,
                icon: 'error'
            });
            this._syncGridSizeInputs();
            return;
        }
        const area = w * h;
        if (area > FluidSimulationApp.GRID_MAX_AREA) {
            Swal.fire({
                title: 'Grade grande demais',
                html: `Uma grade de <strong>${w} × ${h}</strong> tem ${(area / 1000000).toFixed(1)} milhões de células. O limite é ${(FluidSimulationApp.GRID_MAX_AREA / 1000000).toFixed(1)} milhão — acima disso a simulação consome memória demais e trava o navegador em vez de ficar só lenta.`,
                icon: 'error'
            });
            return;
        }
        if (w === this.solver.xdim && h === this.solver.ydim) {
            this._updateGridSizeHint();
            return;
        }
        const pesada = area > FluidSimulationApp.GRID_HEAVY_AREA;
        const result = await Swal.fire({
            title: `Mudar a grade para ${w} × ${h}?`,
            html: `A grade é recriada do zero: <strong>tudo o que está desenhado será apagado</strong> (barreiras, entradas, saídas, rotores e fumaça), e o histórico de desfazer também. Esta ação não pode ser desfeita.${pesada ? `<br><br><strong>Atenção:</strong> ${(area / 1000).toFixed(0)} mil células é uma grade pesada — a simulação vai rodar bem mais devagar que o normal.` : ''}`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: '<i class="fa-solid fa-table-cells"></i> Aplicar tamanho',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#ff5d5d',
            reverseButtons: true
        });
        if (!result.isConfirmed) {
            this._syncGridSizeInputs();
            return;
        }
        // Recriar a grade troca o objeto `solver` inteiro; parar o laço antes evita que um passo
        // já agendado rode em cima do solver antigo logo depois da troca.
        if (this.running) this.startStop();
        this._resetSimulation(w, h);
    }
}
