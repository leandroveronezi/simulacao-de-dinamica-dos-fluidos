// Busca por proximidade (hit-testing) do FluidSimulationApp: qual Entrada, Rotor, fonte de
// fumaça ou forma está sob o cursor. Extraído de FluidSimulationApp.js; os métodos são anexados
// ao protótipo do app por applyMixin, então `this` é a instância do app.

import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102b';

export class HitTesting {
    /**
     * @private
     * @description Retorna o índice do grupo de Entrada cuja seta está perto de `gridLoc`
     * (clicável), ou -1 se nenhum estiver perto o bastante.
     */
    _findSourceGroupNear(gridLoc) {
        this.solver.pruneStaleSourceGroups();
        const groups = this.solver.sourceGroups;
        const threshold = 2;
        const scale = FluidSimulationApp.DIRECTION_HANDLE_TIP_SCALE;
        for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const dOrigin = Math.hypot(gridLoc.x - g.originX, gridLoc.y - g.originY);
            if (dOrigin <= threshold) return i;
            // Também pega perto da PONTA da seta, não só da origem — pegar e arrastar a ponta
            // pra apontar pra onde quiser é mais natural que precisar acertar o pontinho na base.
            const tipX = g.originX + g.vx * scale,
                tipY = g.originY + g.vy * scale;
            if (Math.hypot(gridLoc.x - tipX, gridLoc.y - tipY) <= threshold) return i;
        }
        return -1;
    }

    /**
     * @private
     * @description Retorna o índice do corpo giratório cujo pivô está perto de `gridLoc`
     * (clicável), ou -1 se nenhum estiver perto o bastante.
     */
    _findRotorNearPivot(gridLoc) {
        const bodies = this.solver.rotatingBodies;
        const threshold = 2;
        for (let i = 0; i < bodies.length; i++) {
            const dx = gridLoc.x - bodies[i].pivotX;
            const dy = gridLoc.y - bodies[i].pivotY;
            if (Math.sqrt(dx * dx + dy * dy) <= threshold) return i;
        }
        return -1;
    }

    /**
     * @private
     * @description Retorna o índice do ponto de fumaça/corante perto de `gridLoc` (clicável),
     * ou -1 se nenhum estiver perto o bastante.
     */
    _findDyeSourceNear(gridLoc) {
        const sources = this.solver.dyeSources;
        const threshold = 2;
        for (let i = 0; i < sources.length; i++) {
            const dx = gridLoc.x - sources[i].x;
            const dy = gridLoc.y - sources[i].y;
            if (Math.sqrt(dx * dx + dy * dy) <= threshold) return i;
        }
        return -1;
    }

    /**
     * @private
     * @description Procura, na ordem inversa de empilhamento (forma mais no topo primeiro), uma
     * ponta (x0,y0 ou x1,y1) de alguma forma em `shapes[]` perto de `gridLoc` — clicável pra
     * selecionar e esticar (stretch). Retorna `{shapeIndex, handle}` ou `null`.
     */
    _findShapeHandleNear(gridLoc) {
        const threshold = 2;
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            // Região (preenchimento fundido, geometria livre) não tem "esticar" — só mover o
            // corpo inteiro (ver _findShapeBodyNear) ou apagar.
            if (shape.tool === 'region') continue;
            if (Math.hypot(gridLoc.x - shape.x0, gridLoc.y - shape.y0) <= threshold) {
                return { shapeIndex: i, handle: 'x0y0' };
            }
            if (Math.hypot(gridLoc.x - shape.x1, gridLoc.y - shape.y1) <= threshold) {
                return { shapeIndex: i, handle: 'x1y1' };
            }
        }
        return null;
    }

    /**
     * @private
     * @description Retorna o índice da forma (na ordem inversa de empilhamento) cujo retângulo
     * envolvente contém `gridLoc` — clicar no corpo (longe das pontas) seleciona e permite
     * mover a forma inteira, ou -1 se nenhuma.
     */
    _findShapeBodyNear(gridLoc) {
        for (let i = this.shapes.length - 1; i >= 0; i--) {
            const shape = this.shapes[i];
            const minX = Math.min(shape.x0, shape.x1),
                maxX = Math.max(shape.x0, shape.x1);
            const minY = Math.min(shape.y0, shape.y1),
                maxY = Math.max(shape.y0, shape.y1);
            if (gridLoc.x >= minX && gridLoc.x <= maxX && gridLoc.y >= minY && gridLoc.y <= maxY) return i;
        }
        return -1;
    }
}
