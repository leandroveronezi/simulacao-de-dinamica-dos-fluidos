// Painel de controle (faixa abaixo do canvas) do FluidSimulationApp: interruptores de
// Entrada/Saída/Válvula, velocidade inline e sucção. Extraído de FluidSimulationApp.js; os
// métodos são anexados ao protótipo do app por applyMixin, então `this` é a instância do app.

import { FluidSolver } from '../FluidSolver.js?v=20261102b';
import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102b';

export class ControlPanel {
    /**
     * @private
     * @description Reconstrói o painel de controle (faixa própria abaixo do canvas, bugs.md
     * #50 — substituiu a barra flutuante do #31, que sobrepunha o canvas) a partir de
     * `shapes[]`: um "módulo" por Entrada/Saída/Válvula na cena, com indicador luminoso e
     * interruptor tipo bascule pra abrir/fechar o fluxo sem precisar selecionar a forma; a
     * Entrada ganha também um controle de velocidade inline, item explícito do pedido original
     * ("para entrada poderiamos ter como ajustar a velocidade tb"). Fica escondido se não
     * houver nenhuma das três ainda. Chamada sempre que `_rasterizeShapes()` roda (o chokepoint
     * de "shapes[] mudou").
     */
    _refreshValveWidget() {
        if (!this.valveControlsWidget) return;
        const valves = this.shapes.filter(shape => shape.cellType === FluidSolver.CELL_TYPE.SOURCE || shape.cellType === FluidSolver.CELL_TYPE.SINK || shape.cellType === FluidSolver.CELL_TYPE.VALVE);

        this.valveControlsWidget.hidden = valves.length === 0;
        if (valves.length === 0) return;

        this.valveControlsWidget.innerHTML = '';
        let sourceCount = 0,
            sinkCount = 0,
            valveCount = 0;
        for (const shape of valves) {
            const isSource = shape.cellType === FluidSolver.CELL_TYPE.SOURCE;
            const isSink = shape.cellType === FluidSolver.CELL_TYPE.SINK;
            const isValveShape = shape.cellType === FluidSolver.CELL_TYPE.VALVE;
            const label = isSource ? `E${++sourceCount}` : isSink ? `S${++sinkCount}` : `V${++valveCount}`;
            // Entrada/Saída nascem abertas (undefined conta como aberta); Válvula nasce fechada
            // (só abre com enabled === true estrito) — ver bugs.md #38/#39/#40.
            const isOpen = isValveShape ? shape.enabled === true : shape.enabled !== false;
            const typeName = isSource ? 'Entrada' : isSink ? 'Saída' : 'Válvula';

            const unit = document.createElement('div');
            unit.className = 'control-unit' + (isOpen ? ' open' : '');
            unit.title = `${typeName} ${label} — ${isOpen ? 'aberta' : 'fechada'}`;

            const labelRow = document.createElement('div');
            labelRow.className = 'control-unit-label';
            const led = document.createElement('span');
            led.className = 'control-unit-led';
            labelRow.appendChild(led);
            labelRow.appendChild(document.createTextNode(label));
            unit.appendChild(labelRow);

            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'control-unit-switch';
            input.setAttribute('aria-label', `${typeName} ${label}`);
            input.checked = isOpen;
            input.addEventListener('change', () => {
                this._saveState();
                shape.enabled = input.checked;
                unit.classList.toggle('open', input.checked);
                unit.title = `${typeName} ${label} — ${input.checked ? 'aberta' : 'fechada'}`;
                this._rasterizeShapes();
                this._markDirty();
                this._requestPaint();
            });
            unit.appendChild(input);

            // Ajuste de velocidade inline, só na Entrada (bugs.md #50) — mesmo range/lógica do
            // slider "Velocidade do Fluxo" global, mas por Entrada individual, preservando o
            // ângulo já escolhido (arrastando a seta ou pelo painel flutuante).
            if (isSource) {
                const row = document.createElement('div');
                row.className = 'control-unit-speed';
                const speedInput = document.createElement('input');
                speedInput.type = 'range';
                speedInput.min = '0';
                speedInput.max = String(FluidSimulationApp.MAX_SOURCE_SPEED);
                speedInput.step = '0.005';
                const currentSpeed = Math.hypot(shape.vx, shape.vy);
                speedInput.value = String(currentSpeed);
                const valueLabel = document.createElement('span');
                valueLabel.textContent = currentSpeed.toFixed(2);
                speedInput.addEventListener('input', () => {
                    const speed = Number(speedInput.value);
                    valueLabel.textContent = speed.toFixed(2);
                    const angle = Math.atan2(shape.vy, shape.vx) || 0;
                    this._setSourceVelocity(shape, speed * Math.cos(angle), speed * Math.sin(angle));
                    if (this.selectedShapeIndex >= 0 && this.shapes[this.selectedShapeIndex] === shape) {
                        this._updateFloatingPanel();
                    }
                    this._markDirty();
                    this._requestPaint();
                });
                row.appendChild(speedInput);
                row.appendChild(valueLabel);
                unit.appendChild(row);
            }

            // Ajuste de força de sucção inline, só na Saída (bugs.md #52) — mesmo padrão do
            // slider de velocidade da Entrada logo acima: fica dentro do próprio módulo, sem
            // precisar selecionar a forma. Escala as 9 distribuições da célula por passo (ver
            // FluidSolver._applySourcesAndSinks); 0 volta ao comportamento antigo (dreno
            // puramente visual, sem sucção nenhuma).
            if (isSink) {
                const row = document.createElement('div');
                row.className = 'control-unit-speed';
                const suctionInput = document.createElement('input');
                suctionInput.type = 'range';
                suctionInput.min = '0';
                suctionInput.max = String(FluidSolver.SINK_MAX_SUCTION);
                suctionInput.step = '0.002';
                const currentSuction = shape.suction ?? FluidSolver.SINK_DEFAULT_SUCTION;
                suctionInput.value = String(currentSuction);
                const valueLabel = document.createElement('span');
                valueLabel.textContent = currentSuction.toFixed(3);
                suctionInput.addEventListener('input', () => {
                    const suction = Number(suctionInput.value);
                    valueLabel.textContent = suction.toFixed(3);
                    this._setSinkSuction(shape, suction);
                    this._markDirty();
                    this._requestPaint();
                });
                row.appendChild(suctionInput);
                row.appendChild(valueLabel);
                unit.appendChild(row);
            }

            this.valveControlsWidget.appendChild(unit);
        }
    }
}
