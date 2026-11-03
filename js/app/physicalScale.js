// Escala física do FluidSimulationApp: fluido real + tamanho da célula => unidades do SI
// (m/s, ms, cm) nos controles e no sensor. Extraído no mesmo molde dos outros arquivos de
// js/app/: os métodos são anexados ao protótipo do app por applyMixin, `this` é o app.

import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102c';
import {
    FLUIDOS, FLUIDO_PADRAO, CELULA_PADRAO_MM, CELULA_MIN_MM, CELULA_MAX_MM, calcularEscala, calibrar,
    formatarVelocidade, formatarTempo, formatarComprimento,
} from '../Unidades.js?v=20261102c';

export class PhysicalScale {
    /**
     * @private
     * @description Escala atual (dt, m/s por unidade de rede, m por célula), calculada do fluido
     * escolhido, do tamanho da célula e da viscosidade de rede do slider.
     */
    _physicalScale() {
        const fluido = FLUIDOS[this.fluidSelect.value] || FLUIDOS[FLUIDO_PADRAO];
        let mm = Number(this.cellSizeInput.value);
        mm = Number.isFinite(mm) && mm > 0 ? Math.min(CELULA_MAX_MM, Math.max(CELULA_MIN_MM, mm)) : CELULA_PADRAO_MM;
        return {
            fluido,
            ...calcularEscala({ nuFisico: fluido.nu, tamanhoCelulaM: mm / 1000, nuRede: Number(this.viscSlider.value) }),
        };
    }

    /** @private Preenche o seletor de fluidos e os valores padrão (chamado uma vez no construtor). */
    _initPhysicalScalePanel() {
        this.fluidSelect.innerHTML = Object.entries(FLUIDOS)
            .map(([chave, f]) => `<option value="${chave}">${f.nome}</option>`).join('');
        this.fluidSelect.value = FLUIDO_PADRAO;
        this.cellSizeInput.value = CELULA_PADRAO_MM;
        this.fluidSelect.addEventListener('change', () => this._updatePhysicalScalePanel());
        this.cellSizeInput.addEventListener('input', () => this._updatePhysicalScalePanel());
        // Ao sair do campo, o valor mostrado passa a ser o que a escala realmente usa.
        this.cellSizeInput.addEventListener('change', () => {
            this.cellSizeInput.value = this._physicalScale().comprimento * 1000;
            this._updatePhysicalScalePanel();
        });
        this.calibrateButton.addEventListener('click', () => this._calibratePhysicalScale());
        this._updatePhysicalScalePanel();
    }

    /**
     * @private
     * @description Reescreve o que depende da escala: o resumo do painel, o valor ao lado do
     * slider de velocidade e a velocidade equivalente em m/s no sensor.
     */
    _updatePhysicalScalePanel() {
        if (!this.physicalScaleReadout || !this.solver) return;
        const e = this._physicalScale();
        const u0 = Number(this.speedSlider.value);
        const nuMs = e.fluido.nu.toExponential(1).replace('.', ',');
        this.physicalScaleReadout.innerHTML =
            `1 passo = <strong>${formatarTempo(e.dt)}</strong><br>` +
            `1 unidade de velocidade = <strong>${formatarVelocidade(e.velocidade)}</strong><br>` +
            `Fluxo (u₀) = <strong>${formatarVelocidade(u0 * e.velocidade)}</strong><br>` +
            `Cena = <strong>${formatarComprimento(this.solver.xdim * e.comprimento)} × ${formatarComprimento(this.solver.ydim * e.comprimento)}</strong><br>` +
            `ν real = ${nuMs} m²/s`;
        this.speedValue.innerHTML = `${u0.toFixed(3)} (${formatarVelocidade(u0 * e.velocidade)})`;
        this._requestPaint();
    }

    /**
     * @private
     * @description Botão Calibrar: escolhe a velocidade e a viscosidade de rede que reproduzem a
     * velocidade real pedida (ver `calibrar` em Unidades.js) e avisa quando bate num limite.
     */
    _calibratePhysicalScale() {
        const pedida = Number(this.targetSpeedInput.value);
        if (!(pedida > 0) || !Number.isFinite(pedida)) {
            Swal.fire({ icon: 'warning', title: 'Informe a velocidade', text: 'Digite uma velocidade real maior que zero (em m/s).' });
            return;
        }
        const e = this._physicalScale();
        const r = calibrar({ nuFisico: e.fluido.nu, tamanhoCelulaM: e.comprimento, velocidade: pedida });
        this.speedSlider.value = r.uRede;
        this.viscSlider.value = r.nuRede;
        this._updateSliderFill(this.speedSlider);
        this._updateSliderFill(this.viscSlider);
        this.adjustViscosity();
        this.adjustSpeed();
        if (r.limitado) {
            Swal.fire({
                icon: 'info',
                title: 'Calibração no limite',
                html: `Para ${formatarVelocidade(pedida)} com células de ${formatarComprimento(e.comprimento)}, ` +
                    `o método bateu na ${r.motivo}. A velocidade obtida é <strong>${formatarVelocidade(r.velocidadeObtida)}</strong>. ` +
                    `Células menores aproximam fluxos mais rápidos; células maiores, mais lentos.`,
            });
        }
    }

    /** @private Estado da escala para salvar/exportar. */
    _physicalScaleState() {
        return { fluid: this.fluidSelect.value, cellSizeMm: this._physicalScale().comprimento * 1000 };
    }

    /** @private Restaura a escala de uma configuração (arquivos antigos não têm: usa o padrão). */
    _applyPhysicalScaleState(estado) {
        this.fluidSelect.value = estado && FLUIDOS[estado.fluid] ? estado.fluid : FLUIDO_PADRAO;
        this.cellSizeInput.value = estado && estado.cellSizeMm > 0 ? estado.cellSizeMm : CELULA_PADRAO_MM;
        this._updatePhysicalScalePanel();
    }
}
