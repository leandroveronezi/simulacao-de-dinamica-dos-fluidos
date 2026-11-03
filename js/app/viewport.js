// Viewport do FluidSimulationApp: zoom, pan e conversões entre coordenadas de página, canvas e
// grade. Extraído de FluidSimulationApp.js; os métodos são anexados ao protótipo do app por
// applyMixin, então `this` é a instância do app.

import { Renderer } from '../Renderer.js?v=20261102c';
import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102c';

export class Viewport {
    /**
     * @private
     * @description Restaura zoom=1 e centraliza a grade na viewport. Com a grade maior que a
     * janela (padrão desde o multiplicador de tamanho), ancorar em panX=panY=0 mostrava só o
     * canto superior esquerdo — centralizar dá uma visão inicial mais útil.
     */
    _resetView() {
        this.zoom = 1;
        const viewportWidth = this.canvas.width - Renderer.RULER_SIZE;
        const viewportHeight = this.canvas.height - Renderer.RULER_SIZE;
        const gridContentWidth = this.solver.xdim * this.pxPerSquare;
        const gridContentHeight = this.solver.ydim * this.pxPerSquare;
        this.panX = (viewportWidth - gridContentWidth * this.zoom) / 2;
        this.panY = (viewportHeight - gridContentHeight * this.zoom) / 2;
        this._requestPaint();
    }

    /**
     * @private
     * @description Aplica zoom com a roda do mouse, mantendo o ponto sob o cursor fixo na tela.
     */
    _handleWheelZoom(e) {
        e.preventDefault();
        const rect = this.canvasContainer.getBoundingClientRect();
        const factor = e.deltaY < 0 ? FluidSimulationApp.ZOOM_STEP : 1 / FluidSimulationApp.ZOOM_STEP;
        this._zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }

    /**
     * @private
     * @description Aplica zoom pelos botões +/-, centrado no meio da área visível do canvas.
     */
    _zoomBy(factor) {
        this._zoomAt(factor, this.canvasContainer.clientWidth / 2, this.canvasContainer.clientHeight / 2);
    }

    /**
     * @private
     * @description Muda o zoom por `factor`, mantendo o ponto (pivotX, pivotY) — relativo ao
     * contêiner do canvas — fixo na tela.
     */
    _zoomAt(factor, pivotX, pivotY) {
        const contentX = (pivotX - this.panX) / this.zoom;
        const contentY = (pivotY - this.panY) / this.zoom;

        const newZoom = Math.min(FluidSimulationApp.MAX_ZOOM, Math.max(FluidSimulationApp.MIN_ZOOM, this.zoom * factor));

        this.panX = pivotX - contentX * newZoom;
        this.panY = pivotY - contentY * newZoom;
        this.zoom = newZoom;
        this._requestPaint();
    }

    pageToCanvas(pageX, pageY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (pageX - rect.left) * scaleX,
            y: (pageY - rect.top) * scaleY
        };
    }

    canvasToGrid(canvasX, canvasY) {
        const contentX = (canvasX - Renderer.RULER_SIZE - this.panX) / this.zoom;
        const contentY = (canvasY - Renderer.RULER_SIZE - this.panY) / this.zoom;
        const gridX = Math.floor(contentX / this.pxPerSquare);
        const gridY = this.solver.ydim - 1 - Math.floor(contentY / this.pxPerSquare);
        return {
            x: gridX,
            y: gridY
        };
    }

    /**
     * @private
     * @description Inverso de `canvasToGrid` — de uma coordenada de grade pra um ponto em
     * pixels do canvas (espaço interno, considerando zoom/pan/régua).
     */
    gridToCanvas(gridX, gridY) {
        const contentX = gridX * this.pxPerSquare;
        const contentY = (this.solver.ydim - 1 - gridY) * this.pxPerSquare;
        return {
            x: contentX * this.zoom + this.panX + Renderer.RULER_SIZE,
            y: contentY * this.zoom + this.panY + Renderer.RULER_SIZE
        };
    }

    /**
     * @private
     * @description Como `gridToCanvas`, mas em pixels CSS (não pixels internos do canvas) —
     * usado pra posicionar elementos HTML absolutos dentro de `#canvas-container` (que tem o
     * mesmo tamanho em tela que o canvas).
     */
    _gridToPanelPosition(gridX, gridY) {
        const canvasPt = this.gridToCanvas(gridX, gridY);
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: canvasPt.x / scaleX,
            y: canvasPt.y / scaleY
        };
    }
}
