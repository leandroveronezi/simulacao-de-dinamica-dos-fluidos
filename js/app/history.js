// Histórico de desfazer/refazer do FluidSimulationApp (pilha de snapshots da geometria).
// Extraído de FluidSimulationApp.js; os métodos são anexados ao protótipo do app por applyMixin,
// então `this` é a instância do app.

export class History {
    /**
     * @private
     * @description Só uma fonte de verdade por vez: guarda `rawCellType` (pintura livre) +
     * `shapes[]` (formas vetoriais), NÃO o `cellType` composto — as duas representações da
     * mesma informação podem divergir silenciosamente se guardadas juntas. `solver.particles`
     * (objetos avulsos de bugs.md #32) fica de fora de propósito: sem uma "fonte" que os defina,
     * eles são estado vivo da simulação, não geometria de design — mesmo tratamento que
     * `dyeTracers`/`tracerX/Y` já recebem (nunca entraram no undo, só as SUAS fontes entravam).
     */
    _snapshotState() {
        return {
            rawCellType: this.rawCellType.slice(),
            shapes: JSON.parse(JSON.stringify(this.shapes)),
            sourceVx: this.solver.sourceVx.slice(),
            sourceVy: this.solver.sourceVy.slice(),
            dyeSources: JSON.parse(JSON.stringify(this.solver.dyeSources)),
            rotatingBodies: JSON.parse(JSON.stringify(this.solver.rotatingBodies)),
            sourceGroups: JSON.parse(JSON.stringify(this.solver.sourceGroups))
        };
    }

    _restoreState(state) {
        this.rawCellType = state.rawCellType.slice();
        this.shapes = JSON.parse(JSON.stringify(state.shapes || []));
        this.solver.sourceVx = state.sourceVx.slice();
        this.solver.sourceVy = state.sourceVy.slice();
        this.solver.dyeSources = JSON.parse(JSON.stringify(state.dyeSources));
        this.solver.rotatingBodies = JSON.parse(JSON.stringify(state.rotatingBodies || []));
        this.solver.sourceGroups = JSON.parse(JSON.stringify(state.sourceGroups || []));
        // Nunca deixar _rasterizeShapes() rodar entre restaurar shapes[] e restaurar
        // rotatingBodies[] — a ordem aqui (rasteriza livre+não-Rotor, DEPOIS reestampa Rotor) é
        // a mesma usada na criação/reforma de um Rotor, ver _commitShape/_commitShapeReform.
        this._rasterizeShapes();
        this.solver.stampRotatingBodiesOntoGrid();
        // O índice de seleção não sobrevive a undo/redo — a lista de corpos/formas pode ter mudado.
        this.selectedRotorIndex = -1;
        this.selectedShapeIndex = -1;
        this.draggingShapeHandle = null;
        this._updateFloatingPanel();
        this.initFluid();
    }

    _saveState() {
        this.undoStack.push(this._snapshotState());
        this.redoStack = [];
        this._updateUndoRedoButtons();
        this._markDirty();
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(this._snapshotState());
        this._restoreState(this.undoStack.pop());
        this._updateUndoRedoButtons();
        this._markDirty();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        this.undoStack.push(this._snapshotState());
        this._restoreState(this.redoStack.pop());
        this._updateUndoRedoButtons();
        this._markDirty();
    }

    _updateUndoRedoButtons() {
        this.zoomUndoButton.disabled = this.undoStack.length === 0;
        this.zoomRedoButton.disabled = this.redoStack.length === 0;
    }
}
