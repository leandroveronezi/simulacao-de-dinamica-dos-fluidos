// Arrastos de edição do FluidSimulationApp: esticar/mover forma, direção da seta da Entrada.
// Extraído de FluidSimulationApp.js; os métodos são anexados ao protótipo do app por applyMixin,
// então `this` é a instância do app.

import { FluidSolver } from '../FluidSolver.js?v=20261102c';
import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102c';

export class ShapeDrag {
    /**
     * @private
     * @description Atualiza a geometria da forma selecionada em tempo real, durante o arraste
     * de um handle/corpo — só mexe em `this.shapes[i]` (o modelo de dados), nunca rerrasteriza
     * a grade durante o arraste em si (só no `mouseup`, via `_commitShapeReform`).
     */
    _updateShapeDrag() {
        const drag = this.draggingShapeHandle;
        const shape = this.shapes[drag.shapeIndex];
        if (drag.handle === 'x0y0') {
            shape.x0 = this.mouseGridPos.x;
            shape.y0 = this.mouseGridPos.y;
        } else if (drag.handle === 'x1y1') {
            shape.x1 = this.mouseGridPos.x;
            shape.y1 = this.mouseGridPos.y;
        } else if (drag.handle === 'body') {
            const dx = this.mouseGridPos.x - drag.startGridLoc.x;
            const dy = this.mouseGridPos.y - drag.startGridLoc.y;
            shape.x0 = drag.originalShape.x0 + dx;
            shape.y0 = drag.originalShape.y0 + dy;
            shape.x1 = drag.originalShape.x1 + dx;
            shape.y1 = drag.originalShape.y1 + dy;
        }
    }

    /**
     * @private
     * @description Desfaz um arraste de handle/corpo em andamento (Esc) — a forma volta
     * exatamente pra como estava (a rerrasterização só acontece em `mouseup`/confirmação, então
     * cancelar não precisa desfazer nada na grade, só no objeto em `shapes[]`).
     */
    _cancelShapeDrag() {
        if (!this.draggingShapeHandle) return;
        Object.assign(this.shapes[this.draggingShapeHandle.shapeIndex], this.draggingShapeHandle.originalShape);
        this.draggingShapeHandle = null;
        this.mouseIsDown = false;
        this.floatingPropertyPanel.style.pointerEvents = '';
        this._requestPaint();
    }

    /**
     * @private
     * @description Confirma (mouseup) o arraste de um handle/corpo — delega o trabalho de
     * verdade pra `_reformShapeGeometry`, que também é reaproveitada pelos campos de geometria
     * digitados no painel flutuante (mesmo caminho, duas formas de disparar).
     */
    _commitShapeReform() {
        const drag = this.draggingShapeHandle;
        const shape = this.shapes[drag.shapeIndex];
        const ok = this._reformShapeGeometry(drag.shapeIndex, drag.originalShape);
        if (!ok) Object.assign(shape, drag.originalShape);
        this.draggingShapeHandle = null;
        this.floatingPropertyPanel.style.pointerEvents = '';
        this._updateFloatingPanel();
        this._requestPaint();
    }

    /**
     * @private
     * @description Núcleo da reforma de uma forma — usado tanto ao soltar um handle arrastado
     * quanto ao digitar um valor exato de geometria no painel. Recalcula as células a partir da
     * geometria ATUAL de `shapes[shapeIndex]`, sincroniza o registro físico de Entrada/Rotor (a
     * partir de `oldShape`, a geometria de ANTES da mudança) e rerrasteriza. Reinicia a dinâmica
     * do Rotor (ângulo/velocidade sempre voltam a 0 — não há uma forma limpa de manter
     * continuidade através de uma mudança de geometria), mas preserva o ajuste
     * (massa/amortecimento/rigidez, ou a velocidade da seta de Entrada). Retorna `false` sem
     * aplicar nada se a nova geometria for degenerada (ex.: as duas pontas no mesmo lugar).
     */
    _reformShapeGeometry(shapeIndex, oldShape) {
        const shape = this.shapes[shapeIndex];
        const cells = [];
        this._replayShapeGeometry(shape, (x, y) => {
            if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) cells.push({ x, y });
        });

        if (cells.length === 0) return false;

        if (shape.cellType === FluidSolver.CELL_TYPE.SOURCE) {
            const oldCells = [];
            this._replayShapeGeometry(oldShape, (x, y) => {
                if (x >= 0 && x < this.solver.xdim && y >= 0 && y < this.solver.ydim) oldCells.push({ x, y });
            });
            // Zera sourceVx/vy nas células que a forma abandonou — senão um valor não-zero
            // grudado poderia vazar se essa célula virar parte de uma Entrada futura sem querer.
            for (const { x, y } of oldCells) {
                const i = x + y * this.solver.xdim;
                this.solver.sourceVx[i] = 0;
                this.solver.sourceVy[i] = 0;
            }
            const oldCentroid = { x: (oldShape.x0 + oldShape.x1) / 2, y: (oldShape.y0 + oldShape.y1) / 2 };
            const groupIdx = this._findSourceGroupNear(oldCentroid);
            if (groupIdx >= 0) {
                const { vx, vy } = this.solver.sourceGroups[groupIdx];
                this.solver.sourceGroups.splice(groupIdx, 1);
                this.solver.addSourceGroup(cells, vx, vy);
                shape.vx = vx;
                shape.vy = vy;
            } else {
                this.solver.addSourceGroup(cells, shape.vx, shape.vy);
            }
        } else if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            const oldCentroid = { x: (oldShape.x0 + oldShape.x1) / 2, y: (oldShape.y0 + oldShape.y1) / 2 };
            const bodyIdx = this._findRotorNearPivot(oldCentroid);
            if (bodyIdx >= 0) {
                const body = this.solver.rotatingBodies[bodyIdx];
                Object.assign(shape, this._rotorPropsFrom(body));
                this.solver.addRotatingBody(cells, null, this._rotorPropsFrom(body), bodyIdx);
            } else {
                this.solver.addRotatingBody(cells, null, this._rotorPropsFrom(shape));
            }
        }

        this._rasterizeShapes();
        if (shape.cellType === FluidSolver.CELL_TYPE.ROTOR) {
            for (const { x, y } of cells) {
                this.solver.cellType[x + y * this.solver.xdim] = FluidSolver.CELL_TYPE.ROTOR;
            }
        }
        return true;
    }

    /**
     * @private
     * @description Entra no sub-estado de "reajustar direção" de um grupo de Entrada JÁ
     * existente — arrasta a partir da origem da seta pra redefinir direção/velocidade.
     */
    _beginSourceGroupEdit(index) {
        const group = this.solver.sourceGroups[index];
        this.editingSourceGroupIndex = index;
        this.directionDragOrigin = {
            x: group.originX,
            y: group.originY
        };
        this.directionDragVx = group.vx;
        this.directionDragVy = group.vy;
        this.awaitingDirectionDrag = true;
    }

    _updateDirectionDrag() {
        const dx = this.mouseGridPos.x - this.directionDragOrigin.x;
        const dy = this.mouseGridPos.y - this.directionDragOrigin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const speed = Math.min(FluidSimulationApp.MAX_SOURCE_SPEED, (dist / FluidSimulationApp.DRAG_CELLS_FOR_MAX_SPEED) * FluidSimulationApp.MAX_SOURCE_SPEED);
        if (dist > 0) {
            this.directionDragVx = (dx / dist) * speed;
            this.directionDragVy = (dy / dist) * speed;
        } else {
            this.directionDragVx = 0;
            this.directionDragVy = 0;
        }
    }

    /**
     * @private
     * @description Confirma a direção/velocidade reajustada de um grupo de Entrada existente.
     * Um clique sem arrastar (só selecionar pra olhar) não deve zerar a direção — só grava se
     * o arraste passou de um limiar mínimo; abaixo disso, mantém o que já estava lá.
     */
    _confirmDirectionDrag() {
        if (this.editingSourceGroupIndex >= 0) {
            const dragDistance = Math.sqrt(
                (this.mouseGridPos.x - this.directionDragOrigin.x) ** 2 +
                (this.mouseGridPos.y - this.directionDragOrigin.y) ** 2
            );
            if (dragDistance >= 1) {
                this.solver.updateSourceGroupVelocity(this.editingSourceGroupIndex, this.directionDragVx, this.directionDragVy);
                // shapes[] guarda sua própria cópia de vx/vy (é o que _rasterizeShapes() usa pra
                // reestampar as células de Entrada toda vez que QUALQUER outra coisa muda na
                // grade). Sem sincronizar aqui, a próxima forma desenhada em qualquer lugar (ou
                // undo/redo) rerrasteriza e devolve essa Entrada pra velocidade de quando foi
                // criada, revertendo a direção silenciosamente mesmo com a seta já mostrando a
                // direção nova (a seta lê de sourceGroups, não de shapes[]).
                const shapeIdx = this.shapes.findIndex(s =>
                    s.cellType === FluidSolver.CELL_TYPE.SOURCE &&
                    Math.hypot((s.x0 + s.x1) / 2 - this.directionDragOrigin.x, (s.y0 + s.y1) / 2 - this.directionDragOrigin.y) <= 2
                );
                if (shapeIdx >= 0) {
                    this.shapes[shapeIdx].vx = this.directionDragVx;
                    this.shapes[shapeIdx].vy = this.directionDragVy;
                }
                this._markDirty();
            }
        }
        this.editingSourceGroupIndex = -1;
        this.awaitingDirectionDrag = false;
        this.directionDragOrigin = null;
    }

    /**
     * @private
     * @description Cancela o reajuste em andamento (Esc): a seta volta a como estava, já que só
     * é gravada de volta no grupo em `_confirmDirectionDrag`.
     */
    _cancelDirectionDrag() {
        this.editingSourceGroupIndex = -1;
        this.awaitingDirectionDrag = false;
        this.directionDragOrigin = null;
        this._requestPaint();
    }
}
