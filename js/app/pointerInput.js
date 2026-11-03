// Entrada do ponteiro (mouse) do FluidSimulationApp: pressionar, mover, soltar, sair do canvas,
// ajuste (snap) de pontas e criação de formas. Extraído de FluidSimulationApp.js; os métodos são
// anexados ao protótipo do app por applyMixin, então `this` é a instância do app.

import { FluidSolver } from '../FluidSolver.js?v=20261102c';
import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102c';

export class PointerInput {
    /**
     * @private
     * @description Gruda uma ponta de forma na borda do domínio quando ela cai a poucas células
     * dela. Sem isto é praticamente impossível fechar uma parede/Grade de ponta a ponta: a última
     * linha da grade cai no último pixel da janela (e some de vez quando o painel de controle
     * aparece embaixo), então mesmo arrastando "até o fim" sobrava um vão de várias células —
     * e é justamente pelo chão que as partículas pesadas escapam, já que a gravidade leva todas
     * exatamente pra lá. Só age perto da borda, então desenhar no meio da cena continua igual.
     */
    _snapToDomainEdge(point) {
        const margin = FluidSimulationApp.EDGE_SNAP_CELLS;
        const { xdim, ydim } = this.solver;
        let { x, y } = point;
        if (x <= margin) x = 0;
        else if (x >= xdim - 1 - margin) x = xdim - 1;
        if (y <= margin) y = 0;
        else if (y >= ydim - 1 - margin) y = ydim - 1;
        return { x, y };
    }

    /**
     * @private
     * @description Estende a ponta de uma linha até encostar numa parede já existente, quando
     * ela para a poucas células de uma. Motivo (bugs.md #32): uma Grade atravessando um duto
     * "parece" encostar nas paredes — o traço vetorial é largo (`lineWidth` 1,75) — mas a
     * rasterização física é de UMA célula, então parar 1 célula antes da parede deixa um vão
     * invisível. Medido: um vão de 1 célula só numa ponta já deixou 3 de 6 bolinhas escaparem
     * pela lateral (com a Grade encostada nas duas paredes, nenhuma escapa). Anda no máximo
     * `EDGE_SNAP_CELLS` células e só na direção da própria linha, então não "gruda" em nada
     * longe nem muda uma forma desenhada longe de paredes.
     */
    _snapEndToNearbySolid(point, dirX, dirY) {
        const len = Math.hypot(dirX, dirY);
        if (len === 0) return point;
        const ux = dirX / len,
            uy = dirY / len;
        const { xdim, ydim } = this.solver;
        for (let step = 1; step <= FluidSimulationApp.EDGE_SNAP_CELLS; step++) {
            const x = Math.round(point.x + ux * step),
                y = Math.round(point.y + uy * step);
            if (x < 0 || x >= xdim || y < 0 || y >= ydim) break;
            const t = this.solver.cellType[x + y * xdim];
            if (t === FluidSolver.CELL_TYPE.BARRIER || t === FluidSolver.CELL_TYPE.MESH) {
                return { x, y };
            }
        }
        return point;
    }

    _handleMouseDown(e) {
        e.preventDefault();
        if (this.activeTool === 'pan') {
            this.mouseIsDown = true;
            this.panStart = {
                x: e.pageX,
                y: e.pageY,
                panX: this.panX,
                panY: this.panY
            };
            this.canvasContainer.classList.add('panning');
            return;
        }
        const canvasLoc = this.pageToCanvas(e.pageX, e.pageY);
        const gridLoc = this.canvasToGrid(canvasLoc.x, canvasLoc.y);

        if (this.awaitingDirectionDrag) {
            this.mouseIsDown = true;
            return;
        }

        // Seleção implícita (Entrada/Rotor/forma vetorial por clique perto de um ponto de
        // interesse) só é tentada com a ferramenta Ponteiro ativa — senão um clique com
        // Linha/Fumaça/Borracha em cima de algo já existente "sequestra" o gesto pra seleção
        // em vez de desenhar/apagar/pintar ali, que era exatamente o bug reportado (não dava
        // pra encostar uma linha nova na ponta de outra, nem soltar fumaça sobre uma barreira).
        const clickedSourceGroupIndex = this.activeTool === 'pointer' ? this._findSourceGroupNear(gridLoc) : -1;
        if (clickedSourceGroupIndex >= 0) {
            this._beginSourceGroupEdit(clickedSourceGroupIndex);
            this.mouseIsDown = true;
            return;
        }

        const clickedRotorIndex = this.activeTool === 'pointer' ? this._findRotorNearPivot(gridLoc) : -1;
        if (clickedRotorIndex >= 0) {
            this.selectedRotorIndex = clickedRotorIndex;
            this.selectedShapeIndex = -1;
            const body = this.solver.rotatingBodies[clickedRotorIndex];
            this.draggingRotorPivot = {
                bodyIndex: clickedRotorIndex,
                originalPivot: { x: body.pivotX, y: body.pivotY }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedRotorIndex >= 0) {
            this.selectedRotorIndex = -1;
            this._updateFloatingPanel();
            this._requestPaint();
        }

        const clickedDyeSourceIndex = this.activeTool === 'pointer' ? this._findDyeSourceNear(gridLoc) : -1;
        if (clickedDyeSourceIndex >= 0) {
            this.selectedDyeSourceIndex = clickedDyeSourceIndex;
            this.draggingDyeSource = {
                index: clickedDyeSourceIndex,
                originalPos: { ...this.solver.dyeSources[clickedDyeSourceIndex] }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }
        if (this.selectedDyeSourceIndex >= 0) {
            this.selectedDyeSourceIndex = -1;
            this._updateFloatingPanel();
            this._requestPaint();
        }

        // Seleção/stretch de formas vetoriais (Barreira/Entrada/Saída/Rotor desenhadas com
        // linha/retângulo/elipse/arredondado) — mesma regra acima: só com o Ponteiro ativo.
        const handle = this.activeTool === 'pointer' ? this._findShapeHandleNear(gridLoc) : null;
        if (handle) {
            this._saveState();
            this.selectedRotorIndex = -1;
            this.selectedShapeIndex = handle.shapeIndex;
            this.draggingShapeHandle = {
                shapeIndex: handle.shapeIndex,
                handle: handle.handle,
                startGridLoc: gridLoc,
                originalShape: { ...this.shapes[handle.shapeIndex] }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            // O painel abre perto da seleção — se ficar clicável durante o arraste, ele mesmo
            // intercepta os mousemove/mouseup destinados ao canvas (é um elemento sobreposto).
            // Sem pointer-events:none aqui, esticar/mover pra baixo ou pra direita da forma trava
            // assim que o cursor entra na área do painel.
            this.floatingPropertyPanel.style.pointerEvents = 'none';
            this._requestPaint();
            return;
        }
        const bodyShapeIndex = this.activeTool === 'pointer' ? this._findShapeBodyNear(gridLoc) : -1;
        if (bodyShapeIndex >= 0) {
            this._saveState();
            this.selectedRotorIndex = -1;
            this.selectedShapeIndex = bodyShapeIndex;
            this.draggingShapeHandle = {
                shapeIndex: bodyShapeIndex,
                handle: 'body',
                startGridLoc: gridLoc,
                originalShape: { ...this.shapes[bodyShapeIndex] }
            };
            this.mouseIsDown = true;
            this._updateFloatingPanel();
            this.floatingPropertyPanel.style.pointerEvents = 'none';
            this._requestPaint();
            return;
        }
        if (this.selectedShapeIndex >= 0) {
            this.selectedShapeIndex = -1;
            this._updateFloatingPanel();
            this._requestPaint();
        }

        if (this.clipboard) {
            this._pasteSelection(gridLoc);
            return;
        }

        this.mouseIsDown = true;
        this.toolStartPoint = gridLoc;
        if (this.activePaintType === 'source') this.pendingSourceCells = [];
        if (this.activePaintType === 'rotor') this.pendingRotorCells = [];

        if (this.sensorCheck.checked && gridLoc.x >= 0 && gridLoc.y >= 0) {
            const dx = (gridLoc.x - this.solver.sensorX) * this.pxPerSquare;
            const dy = (gridLoc.y - this.solver.sensorY) * this.pxPerSquare;
            if (Math.sqrt(dx * dx + dy * dy) <= 8) {
                this.draggingSensor = true;
            }
        }

        if (this.draggingSensor) {
            this.solver.sensorX = gridLoc.x;
            this.solver.sensorY = gridLoc.y;
            this._requestPaint();
            return;
        }

        // 'particles' fica de fora de propósito: objetos avulsos não entram no undo (mesmo
        // tratamento que traçadores/fumaça já recebem — são estado "vivo" da simulação, não
        // geometria de design; ver `addParticle`).
        if (['brush', 'fill', 'smoke', 'eraser_line'].includes(this.activeTool)) {
            this._saveState();
        }

        switch (this.activeTool) {
            case 'brush':
                this._paintRawCell(gridLoc.x, gridLoc.y, this._activeCellType());
                this._rasterizeShapes();
                this.lastDrawPoint = gridLoc;
                break;
            case 'eraser_line':
                // Nova ferramenta: borracha em traço livre, apaga célula a célula na diagonal
                // (bugs.md #46). A borracha original (retângulo) continua inalterada.
                this._eraseAt(gridLoc);
                this.lastDrawPoint = gridLoc;
                break;
            case 'fill':
                this._floodFill(gridLoc.x, gridLoc.y);
                break;
            case 'smoke':
                if (gridLoc.x >= 0 && gridLoc.y >= 0) {
                    // Fonte de fumaça tem tipo próprio — não pode ser barreira, entrada, saída,
                    // válvula, rotor ou qualquer outro tipo físico (bugs.md #47). Força a célula
                    // subjacente para NORMAL antes de registrar o ponto: qualquer barreira ou forma
                    // vetorial que existia ali é apagada/recortada por _eraseAt, garantindo que os
                    // traçadores possam ser emitidos e fluir normalmente a partir do ponto colocado.
                    this._eraseAt(gridLoc);
                    this.solver.dyeSources.push({
                        x: gridLoc.x,
                        y: gridLoc.y
                    });
                }
                break;
            case 'particles':
                if (gridLoc.x >= 0 && gridLoc.y >= 0) {
                    // Um objeto avulso por clique (bugs.md #32) — sem fonte contínua, pedido
                    // explícito do usuário (o modelo anterior, copiado da Fumaça, tratava cada
                    // clique como um ponto emitindo pra sempre). Mesmo raciocínio da Fumaça pra
                    // limpar embaixo: um objeto carimbado em cima de uma Barreira nasceria preso
                    // dentro do sólido.
                    this._eraseAt(gridLoc);
                    this.solver.addParticle(
                        gridLoc.x, gridLoc.y,
                        Number(this.particleWeightSlider.value),
                        this.particleTypeSelect.value
                    );
                }
                break;
        }
        this._requestPaint();
    }

    _handleMouseMove(e) {
        e.preventDefault();
        if (this.activeTool === 'pan') {
            if (this.mouseIsDown && this.panStart) {
                this.panX = this.panStart.panX + (e.pageX - this.panStart.x);
                this.panY = this.panStart.panY + (e.pageY - this.panStart.y);
                this._requestPaint();
            }
            return;
        }
        const canvasLoc = this.pageToCanvas(e.pageX, e.pageY);
        this.mouseGridPos = this.canvasToGrid(canvasLoc.x, canvasLoc.y);

        // Cursor de "pode clicar" sobre o pivô de um Rotor, a origem de uma seta de Entrada, ou
        // a ponta/corpo de uma forma vetorial — indica que é selecionável/reajustável antes
        // mesmo do clique.
        if (!this.mouseIsDown) {
            const hoveringHandle = this.activeTool === 'pointer' && (
                this._findRotorNearPivot(this.mouseGridPos) >= 0 ||
                this._findSourceGroupNear(this.mouseGridPos) >= 0 ||
                this._findDyeSourceNear(this.mouseGridPos) >= 0 ||
                !!this._findShapeHandleNear(this.mouseGridPos) ||
                this._findShapeBodyNear(this.mouseGridPos) >= 0
            );
            this.canvas.style.cursor = hoveringHandle ? 'pointer' : '';
        }

        if (this.awaitingDirectionDrag) {
            if (this.mouseIsDown) this._updateDirectionDrag();
            this._requestPaint();
            return;
        }

        if (this.draggingShapeHandle) {
            this._updateShapeDrag();
            this._requestPaint();
            return;
        }

        if (this.draggingRotorPivot) {
            // Preview leve: só repinta (drawRotorPivots lê o novo ponto direto de mouseGridPos
            // via viewState.draggingRotorPivot) — nada de física é tocado até soltar o mouse.
            this._requestPaint();
            return;
        }

        if (this.draggingDyeSource) {
            // Mesma ideia do pivô do Rotor: só preview (drawDyeSources lê a posição nova via
            // viewState.draggingDyeSource) — só grava de verdade no solver ao soltar, senão um
            // clique sem arrastar (só selecionar) já teria "sujado" o undo.
            this._requestPaint();
            return;
        }

        if (this.clipboard) {
            this.pastePreviewOrigin = this.mouseGridPos;
        } else if (this.mouseIsDown) {
            if (this.draggingSensor) {
                this.solver.sensorX = this.mouseGridPos.x;
                this.solver.sensorY = this.mouseGridPos.y;
            } else if (this.activeTool === 'brush' && this.lastDrawPoint) {
                if (this.mouseGridPos.x !== this.lastDrawPoint.x || this.mouseGridPos.y !== this.lastDrawPoint.y) {
                    this._drawLineOnGrid(this.lastDrawPoint, this.mouseGridPos, (x, y) => this._paintRawCell(x, y, this._activeCellType()));
                    this._rasterizeShapes();
                    this.lastDrawPoint = this.mouseGridPos;
                }
            } else if (this.activeTool === 'eraser_line' && this.lastDrawPoint) {
                // Traço contínuo da borracha linha — Bresenham do ponto anterior até o atual,
                // apagando cada célula no caminho (bugs.md #46).
                if (this.mouseGridPos.x !== this.lastDrawPoint.x || this.mouseGridPos.y !== this.lastDrawPoint.y) {
                    this._drawLineOnGrid(this.lastDrawPoint, this.mouseGridPos, (x, y) => this._eraseAt({ x, y }));
                    this.lastDrawPoint = this.mouseGridPos;
                }
            }
        }
        this._requestPaint();
    }

    _handleMouseLeave(e) {
        // Com o botão pressionado, mantém a última posição válida: o mouseup fora do canvas
        // usa mouseGridPos como ponta final do gesto (senão a forma ia parar no canto 0,0).
        if (!this.mouseIsDown) {
            this.mouseGridPos = {
                x: -1,
                y: -1
            };
        }
        this.pastePreviewOrigin = null;
        this._requestPaint();
    }

    _handleMouseUp(e) {
        if (!this.mouseIsDown) return;
        e.preventDefault();

        if (this.activeTool === 'pan') {
            this.mouseIsDown = false;
            this.panStart = null;
            this.canvasContainer.classList.remove('panning');
            return;
        }

        if (this.awaitingDirectionDrag) {
            this._confirmDirectionDrag();
            this.mouseIsDown = false;
            this._requestPaint();
            return;
        }

        if (this.draggingShapeHandle) {
            this._commitShapeReform();
            this.mouseIsDown = false;
            return;
        }

        if (this.draggingRotorPivot) {
            const bodyIndex = this.draggingRotorPivot.bodyIndex;
            const original = this.draggingRotorPivot.originalPivot;
            const dist = Math.hypot(this.mouseGridPos.x - original.x, this.mouseGridPos.y - original.y);
            // Um clique sem arrastar (só selecionar pra ver os sliders) não deve reiniciar
            // angle/omega — só confirma se o arraste passou de um limiar mínimo, mesma regra já
            // usada em _confirmDirectionDrag pro arraste da seta de Entrada.
            if (dist >= 1) {
                this._saveState();
                const body = this.solver.rotatingBodies[bodyIndex];
                // Reaproveita o mesmo caminho de "reforma" que já existe pra Rotor (substitui a
                // entrada no lugar via replaceIndex): recalcula localCells/momentOfInertia/
                // maxRadius relativos ao pivô novo, mantendo as mesmas células (a forma na tela
                // não muda, só o eixo de rotação). angle/omega reiniciam em 0, igual a qualquer
                // outra reforma — preserva massa/amortecimento/rigidez.
                this.solver.addRotatingBody(body.currentCells, { x: this.mouseGridPos.x, y: this.mouseGridPos.y }, this._rotorPropsFrom(body), bodyIndex);
                this._markDirty();
            }
            this.draggingRotorPivot = null;
            this.mouseIsDown = false;
            this._requestPaint();
            return;
        }

        if (this.draggingDyeSource) {
            const original = this.draggingDyeSource.originalPos;
            const dist = Math.hypot(this.mouseGridPos.x - original.x, this.mouseGridPos.y - original.y);
            if (dist >= 1) {
                this._saveState();
                const source = this.solver.dyeSources[this.draggingDyeSource.index];
                source.x = this.mouseGridPos.x;
                source.y = this.mouseGridPos.y;
                this._markDirty();
            }
            this.draggingDyeSource = null;
            this.mouseIsDown = false;
            this._updateFloatingPanel();
            this._requestPaint();
            return;
        }

        if (this.toolStartPoint && !this.draggingSensor) {
            const endPoint = this.mouseGridPos;
            if (this.activeTool === 'select') {
                this.selectionArea = {
                    start: this.toolStartPoint,
                    end: endPoint
                };
                this.selectionOptionsPanel.hidden = false;
            } else if (this.activeTool === 'eraser') {
                this._saveState();
                this._eraseRectangleOnGrid(this.toolStartPoint, endPoint);
            } else if (!['brush', 'fill', 'smoke', 'particles', 'pointer', 'eraser_line'].includes(this.activeTool)) {
                // Linha/retângulo/elipse/arredondado: vira um registro vetorial em shapes[] em
                // vez de pintura imediata — é isso que habilita selecionar/esticar/mover/apagar
                // essa forma depois (edição vetorial), no lugar de pixels sem memória de origem.
                this._saveState();
                this._commitShape(this.activeTool, this.toolStartPoint, endPoint);
            }
        }

        // Pincel/Preenchimento continuam pintura direta de pixel a pixel — a Entrada/Rotor
        // pintados assim (em vez de com uma ferramenta de forma) mantêm o caminho antigo de
        // registrar o grupo/corpo a partir das células acumuladas célula a célula.
        if (this.pendingSourceCells && this.pendingSourceCells.length > 0) {
            this.solver.addSourceGroup(this.pendingSourceCells, FluidSimulationApp.MAX_SOURCE_SPEED * 0.5, 0);
        }
        this.pendingSourceCells = null;

        if (this.pendingRotorCells && this.pendingRotorCells.length > 0) {
            this.solver.addRotatingBody(this.pendingRotorCells, null, { ...this.rotorDefaults });
        }
        this.pendingRotorCells = null;

        this._requestPaint();
        this.mouseIsDown = false;
        this.draggingSensor = false;
        this.lastDrawPoint = null;
        this.toolStartPoint = null;
    }

    /**
     * @private
     * @description Confirma uma forma desenhada com uma ferramenta vetorial (linha/retângulo/
     * elipse/arredondado): grava a geometria em `shapes[]` — fonte de verdade que habilita
     * selecionar/esticar/mover/apagar essa forma depois — e cria o registro físico associado
     * (`solver.addSourceGroup`/`addRotatingBody`) quando o tipo ativo é Entrada/Rotor, mesmo
     * caminho que já existia pra essas duas, só que a partir da geometria da forma em vez de
     * uma lista de células acumulada célula a célula durante o próprio desenho.
     */
    _commitShape(tool, start, end) {
        const cellType = this._activeCellType();
        start = this._snapToDomainEdge(start);
        end = this._snapToDomainEdge(end);
        // Só para linha: encostar as duas pontas numa parede próxima fecha o vão lateral que
        // deixava partículas escaparem pela ponta de uma Grade dentro de um duto (ver
        // `_snapEndToNearbySolid`). Formas de área (retângulo/elipse) não têm "ponta" nesse
        // sentido, então ficam de fora.
        if (tool === 'line') {
            const dx = end.x - start.x,
                dy = end.y - start.y;
            start = this._snapEndToNearbySolid(start, -dx, -dy);
            end = this._snapEndToNearbySolid(end, dx, dy);
        }
        const shape = {
            id: this._nextShapeId++,
            cellType,
            tool,
            x0: start.x,
            y0: start.y,
            x1: end.x,
            y1: end.y
        };
        if (tool === 'line' && this.defaultLineWidth !== FluidSimulationApp.DEFAULT_LINE_WIDTH) {
            shape.lineWidth = this.defaultLineWidth;
        }
        const cells = [];
        this._replayShapeGeometry(shape, (x, y) => {
            if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
        });
        if (cells.length === 0) return;

        if (cellType === FluidSolver.CELL_TYPE.SOURCE) {
            if (tool === 'line') {
                // Direção padrão perpendicular à própria linha (90° CCW) — senão a seta nasce
                // deitada em cima da barreira/entrada que acabou de ser desenhada e fica oculta
                // (bugs.md #6).
                const dx = end.x - start.x,
                    dy = end.y - start.y;
                const len = Math.hypot(dx, dy) || 1;
                shape.vx = (-dy / len) * FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
                shape.vy = (dx / len) * FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
            } else {
                shape.vx = FluidSimulationApp.MAX_SOURCE_SPEED * 0.5;
                shape.vy = 0;
            }
            this.solver.addSourceGroup(cells, shape.vx, shape.vy);
        } else if (cellType === FluidSolver.CELL_TYPE.ROTOR) {
            Object.assign(shape, this._rotorPropsFrom(this.rotorDefaults));
            this.solver.addRotatingBody(cells, null, this._rotorPropsFrom(this.rotorDefaults));
        } else if (cellType === FluidSolver.CELL_TYPE.VALVE) {
            // Nasce fechada (bloqueando, como parede sólida) — precisa ser aberta explicitamente
            // pelo widget, ver bugs.md #40.
            shape.enabled = false;
        } else if (cellType === FluidSolver.CELL_TYPE.MESH) {
            shape.holeSize = FluidSolver.MESH_DEFAULT_HOLE_SIZE;
        } else if (cellType === FluidSolver.CELL_TYPE.SINK) {
            // Força de sucção da Saída (bugs.md #52) — mesmo padrão do `holeSize` da Grade: a
            // "verdade" mora aqui em `shape.suction`, espelhada pro array por célula do solver
            // toda vez que a grade é rasterizada, ajustável depois pelo slider no painel de
            // controle (ver `_refreshValveWidget`).
            shape.suction = FluidSolver.SINK_DEFAULT_SUCTION;
        }

        this.shapes.push(shape);
        // _rasterizeShapes() pula formas ROTOR de propósito na sua rasterização normal, mas
        // reestampa todo `rotatingBodies` por cima no final (bugs.md #41) — cobre tanto este
        // Rotor recém-criado (já em `solver.rotatingBodies` pelo addRotatingBody acima) quanto
        // qualquer outro já existente na cena.
        this._rasterizeShapes();
    }
}
