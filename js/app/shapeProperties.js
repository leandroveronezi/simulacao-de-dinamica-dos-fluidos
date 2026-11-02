// Painel flutuante de propriedades do FluidSimulationApp: edição numérica de geometria,
// posição, velocidade da Entrada, sucção, espessura, furo da Grade, propriedades do Rotor e
// exclusão de formas. Extraído de FluidSimulationApp.js; os métodos são anexados ao protótipo do
// app por applyMixin, então `this` é a instância do app.

import { FluidSolver } from '../FluidSolver.js?v=20260908d';
import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20260908d';
import { DEFAULT_LINE_WIDTH } from '../PolygonGeometry.js?v=20260908d';

export class ShapeProperties {
    /**
     * @private
     * @description Deixa `panel` arrastável pegando em `handle` (clique+arraste). Clicar num
     * `<button>` dentro do handle (ex.: o "×" de fechar do painel) continua funcionando como
     * clique normal, não inicia arraste. Troca `right`/`bottom`/`transform` do CSS padrão por
     * `left`/`top` explícitos assim que o primeiro arraste acontece.
     */
    _makeDraggable(panel, handle) {
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            e.preventDefault();
            const rect = panel.getBoundingClientRect();
            const offsetX = e.clientX - rect.left;
            const offsetY = e.clientY - rect.top;
            panel.style.left = `${rect.left}px`;
            panel.style.top = `${rect.top}px`;
            panel.style.right = '';
            panel.style.bottom = '';
            panel.style.transform = 'none';
            panel.dataset.manuallyPositioned = 'true';

            const onMove = (moveEvent) => {
                panel.style.left = `${moveEvent.clientX - offsetX}px`;
                panel.style.top = `${moveEvent.clientY - offsetY}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    /**
     * @private
     * @description Aplica uma geometria digitada nos campos do painel flutuante (comprimento/
     * ângulo pra linha, largura/altura pras demais) — mesmo caminho de reforma que arrastar um
     * handle, só que a partir de um valor exato em vez da posição do mouse.
     */
    _applyTypedGeometry() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        const oldShape = { ...shape };
        this._saveState();

        if (shape.tool === 'line') {
            const length = Math.max(0, Number(this.floatingPanelLengthInput.value) || 0);
            const angleRad = (Number(this.floatingPanelAngleInput.value) || 0) * Math.PI / 180;
            shape.x1 = Math.round(shape.x0 + length * Math.cos(angleRad));
            shape.y1 = Math.round(shape.y0 + length * Math.sin(angleRad));
        } else {
            const width = Math.max(1, Math.round(Number(this.floatingPanelWidthInput.value) || 1));
            const height = Math.max(1, Math.round(Number(this.floatingPanelHeightInput.value) || 1));
            const signX = shape.x1 >= shape.x0 ? 1 : -1;
            const signY = shape.y1 >= shape.y0 ? 1 : -1;
            shape.x1 = shape.x0 + signX * (width - 1);
            shape.y1 = shape.y0 + signY * (height - 1);
        }

        const ok = this._reformShapeGeometry(this.selectedShapeIndex, oldShape);
        if (!ok) Object.assign(shape, oldShape);
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Aplica a posição X/Y digitada no painel flutuante — move a forma/ponto de
     * fumaça INTEIRO pro lugar exato (mesmo efeito de arrastar o corpo/ponto, só que digitando
     * em vez de mirar com o mouse). Pra uma forma, translada os dois pontos juntos (mantém
     * comprimento/ângulo/largura/altura); reaproveita o mesmo caminho de reforma que o arraste
     * de corpo já usa.
     */
    _applyPosition() {
        const newX = Math.round(Number(this.floatingPanelXInput.value) || 0);
        const newY = Math.round(Number(this.floatingPanelYInput.value) || 0);
        if (this.selectedDyeSourceIndex >= 0) {
            this._saveState();
            const source = this.solver.dyeSources[this.selectedDyeSourceIndex];
            source.x = newX;
            source.y = newY;
            this._markDirty();
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedShapeIndex < 0 && this.selectedRotorIndex >= 0) {
            // Rotor selecionado só pelo pivô (sem forma vetorial correspondente) — move o pivô
            // pro ponto exato, mesmo caminho do arraste (_handleMouseUp/draggingRotorPivot).
            this._saveState();
            const bodyIndex = this.selectedRotorIndex;
            const body = this.solver.rotatingBodies[bodyIndex];
            this.solver.addRotatingBody(body.currentCells, { x: newX, y: newY }, this._rotorPropsFrom(body), bodyIndex);
            this._markDirty();
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        const oldShape = { ...shape };
        this._saveState();
        const dx = newX - shape.x0,
            dy = newY - shape.y0;
        shape.x0 = newX;
        shape.y0 = newY;
        shape.x1 += dx;
        shape.y1 += dy;
        const ok = this._reformShapeGeometry(this.selectedShapeIndex, oldShape);
        if (!ok) Object.assign(shape, oldShape);
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Aplica um vx/vy novo a uma Entrada já existente, mantendo `shape.vx/vy` em
     * sincronia com `solver.sourceGroups`/`sourceVx/vy` (mesma sincronização que
     * `_confirmDirectionDrag` já faz pro arraste). Extraído de `_applySourceVelocity` pra ser
     * reaproveitado pelo slider de velocidade inline do painel de controle (bugs.md #50), que
     * precisa da mesma sincronização mas não passa pelos campos do painel flutuante.
     */
    _setSourceVelocity(shape, vx, vy) {
        shape.vx = vx;
        shape.vy = vy;
        const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
        const groupIdx = this._findSourceGroupNear(centroid);
        if (groupIdx >= 0) {
            this.solver.updateSourceGroupVelocity(groupIdx, vx, vy);
        } else {
            this._rasterizeShapes();
        }
    }

    /**
     * @private
     * @description Ajusta a força de sucção de uma Saída (bugs.md #52), chamado a cada tick do
     * arrasto do slider no painel de controle. Escreve `solver.sinkStrength` diretamente nas
     * células da forma, SEM passar por `_rasterizeShapes()` — que reconstrói `innerHTML` do
     * próprio painel (`_refreshValveWidget`) e destruiria o slider (e o arrasto em andamento)
     * no meio do gesto. Mesmo motivo pelo qual o slider de velocidade da Entrada usa
     * `updateSourceGroupVelocity` em vez de re-rasterizar; aqui não existe um "grupo" próprio no
     * solver pra Saída, então a atualização direta por célula faz esse mesmo papel.
     */
    _setSinkSuction(shape, suction) {
        shape.suction = Math.max(0, Math.min(FluidSolver.SINK_MAX_SUCTION, suction));
        this._replayShapeGeometry(shape, (x, y) => {
            if (x < 0 || x >= this.solver.xdim || y < 0 || y >= this.solver.ydim) return;
            this.solver.sinkStrength[x + y * this.solver.xdim] = shape.suction;
        });
    }

    /**
     * @private
     * @description Aplica velocidade/ângulo do fluxo digitados no painel flutuante pra uma
     * Entrada selecionada — mesmo efeito de arrastar a seta, só que com um valor exato.
     */
    _applySourceVelocity() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        if (shape.cellType !== FluidSolver.CELL_TYPE.SOURCE) return;
        this._saveState();

        const speed = Math.max(0, Math.min(FluidSimulationApp.MAX_SOURCE_SPEED, Number(this.floatingPanelSpeedInput.value) || 0));
        const angleRad = (Number(this.floatingPanelFlowAngleInput.value) || 0) * Math.PI / 180;
        this._setSourceVelocity(shape, speed * Math.cos(angleRad), speed * Math.sin(angleRad));
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Ajusta a espessura do contorno suave de uma linha (puramente cosmético, ver
     * Renderer.drawSmoothLineShapes) — não mexe em geometria/física, só reflete na tela.
     */
    /**
     * @private
     * @description Lê o campo "Para as próximas linhas": valida (1 a 4), devolve o valor limpo ao
     * campo e passa a usá-lo nas linhas desenhadas daqui em diante. Não altera as já existentes.
     */
    _applyDefaultLineWidth() {
        const raw = Number(this.defaultLineWidthInput.value);
        this.defaultLineWidth = Number.isFinite(raw) ? Math.max(1, Math.min(4, raw)) : FluidSimulationApp.DEFAULT_LINE_WIDTH;
        this.defaultLineWidthInput.value = this.defaultLineWidth;
    }

    /**
     * @private
     * @description Aplica a espessura do campo a TODAS as linhas já desenhadas, num único passo
     * desfazível. Avisa em vez de falhar em silêncio quando não há nenhuma linha.
     */
    _applyLineWidthToAll() {
        this._applyDefaultLineWidth();
        const linhas = this.shapes.filter(s => s.tool === 'line');
        if (linhas.length === 0) {
            Swal.fire({ title: 'Nenhuma linha', text: 'Não há linhas desenhadas para ajustar.', icon: 'info' });
            return;
        }
        this._saveState();
        for (const s of linhas) s.lineWidth = this.defaultLineWidth;
        this._rasterizeShapes();
        this._updateFloatingPanel();
        this._markDirty();
        this._requestPaint();
    }

    _applyLineWidth() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        if (shape.tool !== 'line') return;
        this._saveState();
        const width = Number(this.floatingPanelLineWidthInput.value);
        shape.lineWidth = Number.isFinite(width) ? Math.max(1, Math.min(4, width)) : FluidSimulationApp.DEFAULT_LINE_WIDTH;
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Ajusta o furo de uma Grade selecionada (bugs.md #32) — muda física de
     * verdade (o que uma partícula consegue ou não atravessar), então precisa re-rasterizar o
     * array por célula do solver, diferente do puramente-cosmético `_applyLineWidth`.
     */
    _applyMeshHoleSize() {
        if (this.selectedShapeIndex < 0) return;
        const shape = this.shapes[this.selectedShapeIndex];
        if (shape.cellType !== FluidSolver.CELL_TYPE.MESH) return;
        this._saveState();
        shape.holeSize = Number(this.meshHoleSizeSlider.value);
        this.meshHoleSizeValue.textContent = shape.holeSize.toFixed(2);
        this._rasterizeShapes();
        this._markDirty();
        this._requestPaint();
    }

    /**
     * @private
     * @description Remove a forma selecionada (Delete): some de `shapes[]` e, se for Rotor ou
     * Entrada, também do registro físico associado (rotatingBodies/sourceGroups) — senão o
     * corpo/grupo continuaria "vivo" mesmo com a forma apagada da tela.
     */
    _deleteSelectedShape() {
        if (this.selectedShapeIndex < 0) {
            // Rotor selecionado só pelo pivô (sem forma vetorial correspondente, ex.: pintado
            // com Pincel, ou o pivô é o único jeito prático de "pegar" um Rotor que já girou
            // longe da geometria de repouso) — apaga o corpo direto, sem passar por shapes[].
            if (this.selectedRotorIndex >= 0) {
                this._deleteRotorBody(this.selectedRotorIndex);
                return;
            }
            if (this.selectedDyeSourceIndex >= 0) {
                this._saveState();
                this.solver.dyeSources.splice(this.selectedDyeSourceIndex, 1);
                this.selectedDyeSourceIndex = -1;
                this._markDirty();
                this._updateFloatingPanel();
                this._requestPaint();
            }
            return;
        }
        this._saveState();
        const shape = this.shapes[this.selectedShapeIndex];
        const cells = [];
        this._replayShapeGeometry(shape, (x, y) => {
            if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
        });

        if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
            for (const { x, y } of cells) {
                const i = x + y * this.solver.xdim;
                this.solver.sourceVx[i] = 0;
                this.solver.sourceVy[i] = 0;
            }
            const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
            const groupIdx = this._findSourceGroupNear(centroid);
            if (groupIdx >= 0) this.solver.sourceGroups.splice(groupIdx, 1);
        } else if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
            const bodyIdx = this._findRotorNearPivot(centroid);
            if (bodyIdx >= 0) {
                this.solver.rotatingBodies.splice(bodyIdx, 1);
                for (const { x, y } of cells) {
                    const i = x + y * this.solver.xdim;
                    if (this.solver.cellType[i] === FluidSolver.CELL_TYPE.ROTOR) {
                        this.solver.cellType[i] = FluidSolver.CELL_TYPE.NORMAL;
                        this.solver._refillCell(x, y);
                    }
                }
            }
        }

        this.shapes.splice(this.selectedShapeIndex, 1);
        this.selectedShapeIndex = -1;
        this._rasterizeShapes();
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Apaga um corpo giratório pelo índice em `rotatingBodies` — usado quando ele
     * foi selecionado só pelo pivô (sem `selectedShapeIndex`, ex.: Rotor pintado com Pincel, ou
     * já girado longe da geometria de repouso). Também remove a entrada correspondente em
     * `shapes[]`, se houver uma, pra não deixar uma forma "fantasma" sem corpo por trás.
     */
    _deleteRotorBody(bodyIndex) {
        this._saveState();
        const body = this.solver.rotatingBodies[bodyIndex];
        for (const { x, y } of body.currentCells) {
            const i = x + y * this.solver.xdim;
            if (this.solver.cellType[i] === FluidSolver.CELL_TYPE.ROTOR) {
                this.solver.cellType[i] = FluidSolver.CELL_TYPE.NORMAL;
                this.solver._refillCell(x, y);
            }
        }
        this.solver.rotatingBodies.splice(bodyIndex, 1);

        const shapeIdx = this.shapes.findIndex(s => {
            if (s.cellType !== FluidSolver.CELL_TYPE.ROTOR) return false;
            const cx = (s.x0 + s.x1) / 2,
                cy = (s.y0 + s.y1) / 2;
            return Math.hypot(cx - body.pivotX, cy - body.pivotY) <= 2;
        });
        if (shapeIdx >= 0) this.shapes.splice(shapeIdx, 1);

        this.selectedRotorIndex = -1;
        this.selectedShapeIndex = -1;
        this._rasterizeShapes();
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Escreve um valor de propriedade do Rotor: no corpo mostrado no painel
     * flutuante, se houver um selecionado; senão nos valores padrão usados ao criar o PRÓXIMO
     * Rotor. Mantém o metadado da forma vetorial correspondente em sincronia, se houver uma
     * (pra sobreviver a export/import e a uma eventual reforma).
     */
    /**
     * @private
     * @description Coleta as propriedades de ajuste de Rotor de uma origem qualquer (um corpo do
     * solver, uma forma vetorial, uma configuração importada), caindo no padrão para as que
     * faltarem — é o que permite um arquivo salvo antes de uma propriedade existir continuar
     * abrindo com o valor padrão dela.
     */
    _rotorPropsFrom(source) {
        const out = {};
        for (const key of FluidSimulationApp.ROTOR_PROP_KEYS) {
            out[key] = source?.[key] ?? this.rotorDefaults[key];
        }
        return out;
    }

    /**
     * @private
     * @description Deixa a chave de 3 posições e o slider de velocidade coerentes com a direção
     * dada: marca o botão certo como ativo e mostra a velocidade só quando o motor está ligado
     * (com o motor desligado ela não teria efeito nenhum, e um slider inerte na tela só confunde).
     */
    _syncRotorMotorControls(direction, speed) {
        if (!this.rotorMotorButtons) return;
        const dir = Number(direction) || 0;
        for (const button of this.rotorMotorButtons) {
            button.classList.toggle('active', Number(button.dataset.motor) === dir);
        }
        if (speed !== undefined) {
            const pct = Math.round(speed * 100);
            this.rotorMotorSpeedSlider.value = pct;
            this.rotorMotorSpeedValue.innerHTML = `${pct}%`;
            this._updateSliderFill(this.rotorMotorSpeedSlider);
        }
        this.rotorMotorSpeedRow.hidden = dir === 0;
    }

    _writeRotorProperty(key, value) {
        const idx = this._activeRotorBodyIndexForPanel ?? -1;
        if (idx >= 0 && this.solver.rotatingBodies[idx]) {
            this.solver.rotatingBodies[idx][key] = value;
            if (this.selectedShapeIndex >= 0) {
                const shape = this.shapes[this.selectedShapeIndex];
                if (shape && shape.cellType === FluidSolver.CELL_TYPE.ROTOR) shape[key] = value;
            }
        } else {
            this.rotorDefaults[key] = value;
        }
    }

    /**
     * @private
     * @description Painel de propriedades flutuante — substitui o antigo painel fixo na
     * sidebar. Mostra geometria (forma vetorial selecionada) e/ou os sliders de Rotor (corpo
     * selecionado pelo pivô OU forma vetorial de tipo Rotor selecionada), posicionado perto da
     * seleção em tela. Escondido quando nada está selecionado.
     */
    _updateFloatingPanel() {
        if (!this.floatingPropertyPanel) return;
        const shape = this.selectedShapeIndex >= 0 ? this.shapes[this.selectedShapeIndex] : null;
        let rotorBodyIndex = -1;
        if (shape && shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            const centroid = { x: (shape.x0 + shape.x1) / 2, y: (shape.y0 + shape.y1) / 2 };
            rotorBodyIndex = this._findRotorNearPivot(centroid);
        } else if (!shape && this.selectedRotorIndex >= 0) {
            rotorBodyIndex = this.selectedRotorIndex;
        }
        this._activeRotorBodyIndexForPanel = rotorBodyIndex;
        const dyeIndex = (!shape && rotorBodyIndex < 0) ? this.selectedDyeSourceIndex : -1;

        // Uma seleção NOVA (não só uma edição na mesma forma já selecionada) esquece qualquer
        // arraste manual de antes — senão o painel arrastado pra longe de uma forma ficaria
        // "preso" longe da próxima seleção também. Editar um campo da MESMA forma (o que também
        // chama _updateFloatingPanel) não deve fazer o painel pular de volta.
        const selectionKey = shape ? `shape:${shape.id}` : (rotorBodyIndex >= 0 ? `rotor:${rotorBodyIndex}` : (dyeIndex >= 0 ? `dye:${dyeIndex}` : null));
        if (selectionKey !== this._panelSelectionKey) {
            this._panelSelectionKey = selectionKey;
            delete this.floatingPropertyPanel.dataset.manuallyPositioned;
        }

        const hasSelection = !!shape || rotorBodyIndex >= 0 || dyeIndex >= 0;
        this.floatingPropertyPanel.hidden = !hasSelection;
        if (!hasSelection) return;

        if (dyeIndex >= 0) {
            this.floatingPanelTitle.textContent = 'Fumaça';
            this.floatingPanelGeometryLine.hidden = true;
            this.floatingPanelGeometryRect.hidden = true;
            this.floatingPanelSourceControls.hidden = true;
            this.floatingPanelRotorControls.hidden = true;
            this.floatingPanelMeshControls.hidden = true;
            this.floatingPanelPositionEdit.hidden = false;
            const source = this.solver.dyeSources[dyeIndex];
            const active = document.activeElement;
            if (active !== this.floatingPanelXInput) this.floatingPanelXInput.value = source.x;
            if (active !== this.floatingPanelYInput) this.floatingPanelYInput.value = source.y;
            this.deleteShapeButton.hidden = false;
            if (!this.floatingPropertyPanel.dataset.manuallyPositioned) {
                this._positionFloatingPanel(null, -1, { x: source.x, y: source.y });
            }
            return;
        }

        const typeLabels = {
            [FluidSolver.CELL_TYPE.BARRIER]: 'Barreira',
            [FluidSolver.CELL_TYPE.SOURCE]: 'Entrada',
            [FluidSolver.CELL_TYPE.SINK]: 'Saída',
            [FluidSolver.CELL_TYPE.ROTOR]: 'Rotor',
            [FluidSolver.CELL_TYPE.VALVE]: 'Válvula',
            [FluidSolver.CELL_TYPE.MESH]: 'Grade'
        };
        if (shape) {
            this.floatingPanelTitle.textContent = typeLabels[shape.cellType] || 'Forma';
            const dx = shape.x1 - shape.x0,
                dy = shape.y1 - shape.y0;
            const isLine = shape.tool === 'line';
            const isRegion = shape.tool === 'region';
            this.floatingPanelPositionEdit.hidden = false;
            this.floatingPanelGeometryLine.hidden = !isLine;
            this.floatingPanelGeometryRect.hidden = isLine || isRegion;
            const active = document.activeElement;
            if (active !== this.floatingPanelXInput) this.floatingPanelXInput.value = shape.x0;
            if (active !== this.floatingPanelYInput) this.floatingPanelYInput.value = shape.y0;
            if (isLine) {
                if (active !== this.floatingPanelLengthInput) {
                    this.floatingPanelLengthInput.value = Math.sqrt(dx * dx + dy * dy).toFixed(1);
                }
                if (active !== this.floatingPanelAngleInput) {
                    this.floatingPanelAngleInput.value = (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(0);
                }
                if (active !== this.floatingPanelLineWidthInput) {
                    this.floatingPanelLineWidthInput.value = (shape.lineWidth ?? FluidSimulationApp.DEFAULT_LINE_WIDTH).toFixed(1);
                }
            } else if (!isRegion) {
                if (active !== this.floatingPanelWidthInput) {
                    this.floatingPanelWidthInput.value = Math.abs(dx) + 1;
                }
                if (active !== this.floatingPanelHeightInput) {
                    this.floatingPanelHeightInput.value = Math.abs(dy) + 1;
                }
            }
            // Região (preenchimento fundido) não tem geometria editável — só mover/apagar, ver
            // _findShapeHandleNear. As duas seções acima já ficam escondidas nesse caso.
            this.deleteShapeButton.hidden = false;
        } else {
            // Rotor selecionado só pelo pivô (sem forma vetorial correspondente) — sem leitura
            // de geometria (não há x0/y0/x1/y1 pra mostrar), mas AINDA precisa dar pra apagar,
            // senão o pivô fica "preso" na tela sem jeito de removê-lo.
            this.floatingPanelTitle.textContent = 'Rotor';
            this.floatingPanelGeometryLine.hidden = true;
            this.floatingPanelGeometryRect.hidden = true;
            this.floatingPanelPositionEdit.hidden = false;
            const body = this.solver.rotatingBodies[rotorBodyIndex];
            const active = document.activeElement;
            if (active !== this.floatingPanelXInput) this.floatingPanelXInput.value = Math.round(body.pivotX);
            if (active !== this.floatingPanelYInput) this.floatingPanelYInput.value = Math.round(body.pivotY);
            this.deleteShapeButton.hidden = false;
        }

        const showSourceControls = !!shape && shape.cellType === FluidSolver.CELL_TYPE.SOURCE;
        this.floatingPanelSourceControls.hidden = !showSourceControls;
        if (showSourceControls) {
            const active = document.activeElement;
            const speed = Math.hypot(shape.vx, shape.vy);
            if (active !== this.floatingPanelSpeedInput) {
                this.floatingPanelSpeedInput.value = speed.toFixed(3);
            }
            if (active !== this.floatingPanelFlowAngleInput) {
                this.floatingPanelFlowAngleInput.value = (Math.atan2(shape.vy, shape.vx) * 180 / Math.PI).toFixed(0);
            }
        }

        const showMeshControls = !!shape && shape.cellType === FluidSolver.CELL_TYPE.MESH;
        this.floatingPanelMeshControls.hidden = !showMeshControls;
        if (showMeshControls) {
            const active = document.activeElement;
            if (active !== this.meshHoleSizeSlider) {
                const holeSize = shape.holeSize ?? FluidSolver.MESH_DEFAULT_HOLE_SIZE;
                this.meshHoleSizeSlider.value = holeSize;
                this.meshHoleSizeValue.textContent = holeSize.toFixed(2);
                this._updateSliderFill(this.meshHoleSizeSlider);
            }
        }

        const showRotorControls = rotorBodyIndex >= 0;
        this.floatingPanelRotorControls.hidden = !showRotorControls;
        if (showRotorControls) {
            const body = this.solver.rotatingBodies[rotorBodyIndex];
            this.rotorMassSlider.value = body.massMultiplier;
            this.rotorMassValue.innerHTML = Number(body.massMultiplier).toFixed(1);
            this.rotorDampingSlider.value = body.damping;
            this.rotorDampingValue.innerHTML = Number(body.damping).toFixed(3);
            this.rotorStiffnessSlider.value = body.stiffness;
            this.rotorStiffnessValue.innerHTML = Number(body.stiffness).toFixed(3);
            this._updateSliderFill(this.rotorMassSlider);
            this._updateSliderFill(this.rotorDampingSlider);
            this._updateSliderFill(this.rotorStiffnessSlider);
            this._syncRotorMotorControls(body.motorDirection ?? 0, body.motorSpeed ?? this.rotorDefaults.motorSpeed);
        }

        if (!this.floatingPropertyPanel.dataset.manuallyPositioned) {
            this._positionFloatingPanel(shape, rotorBodyIndex);
        }
    }

    /**
     * @private
     * @description Posiciona o painel flutuante perto do canto/pivô da seleção em tela —
     * recalculado aqui (chamado sempre que a seleção ou zoom/pan mudam via _updateFloatingPanel
     * e _requestPaint, respectivamente, ver paintCanvas).
     */
    _positionFloatingPanel(shape, rotorBodyIndex, dyePos = null) {
        let gx, gy;
        if (shape) {
            gx = Math.max(shape.x0, shape.x1);
            gy = Math.max(shape.y0, shape.y1);
        } else if (dyePos) {
            gx = dyePos.x;
            gy = dyePos.y;
        } else {
            const body = this.solver.rotatingBodies[rotorBodyIndex];
            gx = body.pivotX;
            gy = body.pivotY;
        }
        const pos = this._gridToPanelPosition(gx, gy);
        this.floatingPropertyPanel.style.left = `${pos.x + 12}px`;
        this.floatingPropertyPanel.style.top = `${pos.y}px`;
    }
}
