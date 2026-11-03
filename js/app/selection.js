// Seleção retangular e área de transferência do FluidSimulationApp: copiar, recortar, colar,
// espelhar e girar. Extraído de FluidSimulationApp.js; os métodos são anexados ao protótipo do
// app por applyMixin, então `this` é a instância do app.

import { FluidSolver } from '../FluidSolver.js?v=20261102a';

export class Selection {
    _getSelectionBounds() {
        if (!this.selectionArea) return null;
        const x_start = Math.min(this.selectionArea.start.x, this.selectionArea.end.x);
        const x_end = Math.max(this.selectionArea.start.x, this.selectionArea.end.x);
        const y_start = Math.min(this.selectionArea.start.y, this.selectionArea.end.y);
        const y_end = Math.max(this.selectionArea.start.y, this.selectionArea.end.y);
        return {
            x_start,
            x_end,
            y_start,
            y_end
        };
    }

    _copySelection() {
        if (!this.selectionArea) return;
        const bounds = this._getSelectionBounds();
        const cells = [];
        for (let x = bounds.x_start; x <= bounds.x_end; x++) {
            for (let y = bounds.y_start; y <= bounds.y_end; y++) {
                const type = this.solver.cellType[x + y * this.solver.xdim];
                if (type !== FluidSolver.CELL_TYPE.NORMAL && type !== FluidSolver.CELL_TYPE.ROTOR) {
                    cells.push({
                        x: x - bounds.x_start,
                        y: y - bounds.y_start,
                        type: type
                    });
                }
            }
        }
        this.clipboard = {
            width: bounds.x_end - bounds.x_start + 1,
            height: bounds.y_end - bounds.y_start + 1,
            cells: cells
        };
        this._clearSelection();
        this.canvas.style.cursor = 'copy';
    }

    _cutSelection() {
        if (!this.selectionArea) return;
        // `_copySelection` termina limpando `selectionArea`, e `_deleteSelection` precisa dela:
        // sem restaurá-la o recorte só copiava e nunca apagava a origem. Salva o ponto de
        // desfazer (true) porque a cópia não salva nenhum, e recortar tem que ser desfazível.
        const area = this.selectionArea;
        this._copySelection();
        this.selectionArea = area;
        this._deleteSelection(true);
    }

    _pasteSelection(origin) {
        if (!this.clipboard) return;
        this._saveState();
        for (const p of this.clipboard.cells) {
            this._paintRawCell(origin.x + p.x, origin.y + p.y, p.type);
        }
        this._rasterizeShapes();
        this.initFluid();
    }

    _flipSelectionHorizontal() {
        this._transformSelection((x, y, b) => ({
            newX: b.x_start + b.x_end - x,
            newY: y
        }));
    }

    _flipSelectionVertical() {
        this._transformSelection((x, y, b) => ({
            newX: x,
            newY: b.y_start + b.y_end - y
        }));
    }

    _rotateSelection(degrees) {
        if (!this.selectionArea) return;
        this._saveState();
        const bounds = this._getSelectionBounds();
        const centerX = (bounds.x_start + bounds.x_end) / 2;
        const centerY = (bounds.y_start + bounds.y_end) / 2;
        const newCells = [];
        for (let x = bounds.x_start; x <= bounds.x_end; x++) {
            for (let y = bounds.y_start; y <= bounds.y_end; y++) {
                const type = this.solver.cellType[x + y * this.solver.xdim];
                if (type !== FluidSolver.CELL_TYPE.NORMAL && type !== FluidSolver.CELL_TYPE.ROTOR) {
                    const dx = x - centerX;
                    const dy = y - centerY;
                    let newX, newY;
                    if (degrees === 90) {
                        newX = Math.round(centerX - dy);
                        newY = Math.round(centerY + dx);
                    } else if (degrees === 180) {
                        newX = Math.round(centerX - dx);
                        newY = Math.round(centerY - dy);
                    } else if (degrees === 270) {
                        newX = Math.round(centerX + dy);
                        newY = Math.round(centerY - dx);
                    }
                    if (newX >= 0 && newX < this.solver.xdim && newY >= 0 && newY < this.solver.ydim) {
                        newCells.push({
                            x: newX,
                            y: newY,
                            type: type
                        });
                    }
                }
            }
        }
        this._deleteSelection(false);
        for (const p of newCells) {
            this._paintRawCell(p.x, p.y, p.type);
        }
        this._rasterizeShapes();
        this.initFluid();
    }

    _transformSelection(transformFunc) {
        if (!this.selectionArea) return;
        this._saveState();
        const bounds = this._getSelectionBounds();
        const newCells = [];
        for (let x = bounds.x_start; x <= bounds.x_end; x++) {
            for (let y = bounds.y_start; y <= bounds.y_end; y++) {
                const type = this.solver.cellType[x + y * this.solver.xdim];
                if (type !== FluidSolver.CELL_TYPE.NORMAL && type !== FluidSolver.CELL_TYPE.ROTOR) {
                    const {
                        newX,
                        newY
                    } = transformFunc(x, y, bounds);
                    newCells.push({
                        x: newX,
                        y: newY,
                        type: type
                    });
                }
            }
        }
        this._deleteSelection(false);
        for (const p of newCells) {
            this._paintRawCell(p.x, p.y, p.type);
        }
        this._rasterizeShapes();
        this.initFluid();
    }

    _deleteSelection(saveState = true) {
        if (!this.selectionArea) return;
        if (saveState) this._saveState();
        this._eraseRectangleOnGrid(this.selectionArea.start, this.selectionArea.end);
        this._clearSelection();
        this.initFluid();
    }

    _clearSelection() {
        if (this.selectionArea) {
            this.selectionArea = null;
            this.selectionOptionsPanel.hidden = true;
            this._requestPaint();
        }
    }

    _clearClipboard() {
        this.clipboard = null;
        this.pastePreviewOrigin = null;
        // Limpa o cursor inline (não força 'crosshair') — assim a regra CSS de
        // #canvas-container.tool-pan continua controlando o cursor de "mover" (grab/grabbing).
        this.canvas.style.cursor = '';
    }
}
