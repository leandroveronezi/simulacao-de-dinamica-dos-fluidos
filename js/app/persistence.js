// Persistência do FluidSimulationApp: autosave, projetos locais nomeados (localStorage) e
// exportar/importar a configuração em JSON. Extraído de FluidSimulationApp.js; os métodos são
// anexados ao protótipo do app por applyMixin, então `this` é a instância do app.

import { FluidSimulationApp } from '../FluidSimulationApp.js?v=20261102a';

export class Persistence {
    /**
     * @private
     * @description Tenta restaurar a última sessão salva automaticamente (localStorage), pra
     * que dar F5 ou fechar a aba sem exportar não jogue o desenho fora. Retorna false (e não
     * mexe em nada) se não houver autosave, se estiver corrompido, ou se for de um formato
     * antigo demais pra ser aplicado com segurança.
     */
    _tryRestoreAutoSave() {
        let raw;
        try {
            raw = localStorage.getItem(FluidSimulationApp.AUTOSAVE_KEY);
        } catch (err) {
            return false;
        }
        if (!raw) return false;
        try {
            const config = JSON.parse(raw);
            if (!config || config.version < 15) return false;
            this._applyConfiguration(config, { silent: true });
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'info',
                title: 'Sessão anterior restaurada automaticamente',
                showConfirmButton: false,
                timer: 2500,
                timerProgressBar: true
            });
            return true;
        } catch (err) {
            console.warn('Autosave corrompido, ignorando:', err);
            return false;
        }
    }

    /**
     * @private
     * @description Salva o estado atual (geometria + parâmetros) no localStorage, com debounce
     * pra não escrever a cada célula pintada — só depois de uma pausa nas edições. Ver também
     * `_flushAutoSaveSync`, a rede de segurança pra quando a página fecha/recarrega ANTES desse
     * debounce disparar (senão um F5 imediato depois de desenhar perderia o desenho).
     */
    _scheduleAutoSave() {
        clearTimeout(this._autoSaveTimeout);
        this._autoSaveTimeout = setTimeout(() => this._writeAutoSave(), FluidSimulationApp.AUTOSAVE_DEBOUNCE_MS);
    }

    _writeAutoSave() {
        try {
            localStorage.setItem(FluidSimulationApp.AUTOSAVE_KEY, JSON.stringify(this._buildConfigObject()));
        } catch (err) {
            console.warn('Autosave falhou:', err);
        }
    }

    /**
     * @private
     * @description Grava o autosave imediatamente (sem esperar o debounce) — chamado quando a
     * aba está prestes a ficar oculta ou fechar (`visibilitychange`/`pagehide`). Sem isso, um
     * F5 logo após desenhar (antes do debounce de 1s completar) perderia a edição.
     */
    _flushAutoSaveSync() {
        clearTimeout(this._autoSaveTimeout);
        this._writeAutoSave();
    }

    /**
     * @private
     * @description Monta o objeto de configuração completo (geometria + parâmetros de UI) —
     * usado tanto pra exportar um arquivo .json quanto pro autosave em localStorage.
     */
    _buildConfigObject() {
        return {
            version: 17,
            xdim: this.solver.xdim,
            ydim: this.solver.ydim,
            boundaryMode: this.solver.boundaryMode,
            rawCellType: Array.from(this.rawCellType),
            shapes: this.shapes,
            sourceVx: Array.from(this.solver.sourceVx),
            sourceVy: Array.from(this.solver.sourceVy),
            dyeSources: this.solver.dyeSources,
            rotatingBodies: this.solver.rotatingBodies,
            sourceGroups: this.solver.sourceGroups,
            physicalScale: this._physicalScaleState(),
            flowSpeed: this.speedSlider.value,
            viscosity: this.viscSlider.value,
            animationSpeed: this.stepsSlider.value,
            plotMode: this.plotSelect.selectedIndex,
            contrast: this.contrastSlider.value,
            showTracers: this.tracerCheck.checked,
            showForce: this.forceCheck.checked,
            showArrows: this.arrowsCheck.checked,
            showSensor: this.sensorCheck.checked,
            zoom: this.zoom,
            panX: this.panX,
            panY: this.panY
        };
    }

    _exportConfiguration() {
        const config = this._buildConfigObject();
        const blob = new Blob([JSON.stringify(config, null, 2)], {
            type: "application/json"
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'fluid-sim-config.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    _importConfiguration() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = event => {
                try {
                    const config = JSON.parse(event.target.result);
                    if (config.version < 15) throw new Error('Formato de arquivo antigo ou incompatível (não guarda o tamanho da grade/objetos giratórios). Exporte novamente.');
                    this._applyConfiguration(config);
                    // Arquivo importado não é um projeto local salvo — "Salvar" deve pedir um
                    // nome (Salvar Como), não sobrescrever um projeto qualquer sem querer.
                    this.activeProjectId = null;
                    this.activeProjectName = null;
                    this.hasUnsavedChanges = false;
                    this._updateProjectIndicator();
                } catch (err) {
                    Swal.fire('Erro', `Não foi possível importar a configuração: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    _applyConfiguration(config, { silent = false } = {}) {
        this._applyPhysicalScaleState(config.physicalScale);
        this.speedSlider.value = config.flowSpeed;
        this.adjustSpeed();
        this.viscSlider.value = config.viscosity;
        this.adjustViscosity();
        this.stepsSlider.value = config.animationSpeed;
        this.plotSelect.selectedIndex = config.plotMode;
        this.contrastSlider.value = config.contrast;
        this.tracerCheck.checked = config.showTracers;
        this.forceCheck.checked = config.showForce;
        this.arrowsCheck.checked = !!config.showArrows;
        this.sensorCheck.checked = config.showSensor;
        this.boundaryModeSelect.value = config.boundaryMode || 'channel';
        this._resetSimulation(config.xdim, config.ydim);
        // v17+ guarda rawCellType+shapes (buffer duplo). Arquivos v15/v16 só têm o `cellTypes`
        // composto (de antes da edição vetorial existir) — migra tratando esse composto inteiro
        // como camada livre, sem formas vetoriais (a geometria continua funcionando igual,
        // só não vem individualmente selecionável/editável).
        if (config.rawCellType) {
            this.rawCellType = Uint8Array.from(config.rawCellType);
            this.shapes = JSON.parse(JSON.stringify(config.shapes || []));
        } else {
            this.rawCellType = Uint8Array.from(config.cellTypes || []);
            this.shapes = [];
        }
        if (config.sourceVx) this.solver.sourceVx = Float32Array.from(config.sourceVx);
        if (config.sourceVy) this.solver.sourceVy = Float32Array.from(config.sourceVy);
        this.solver.dyeSources = config.dyeSources || [];
        // Backfill com os padrões: um arquivo exportado antes de propriedades por Rotor
        // existirem não vai ter massMultiplier/damping/stiffness em cada corpo.
        this.solver.rotatingBodies = (config.rotatingBodies || []).map(body => ({
            ...body,
            ...this._rotorPropsFrom(body)
        }));
        // Arquivos de antes dos grupos de Entrada existirem não vão ter isso — fica vazio, a
        // Entrada em si (sourceVx/sourceVy) continua funcionando normalmente, só não vem
        // agrupada/selecionável.
        this.solver.sourceGroups = config.sourceGroups || [];
        this._rasterizeShapes();
        this.solver.stampRotatingBodiesOntoGrid();
        this.selectedRotorIndex = -1;
        this.selectedShapeIndex = -1;
        this.editingSourceGroupIndex = -1;
        this.initFluid();
        this.solver.initTracers(this.tracerCheck.checked);
        this.solver.initDyeTracers();
        this.solver.initParticles();
        this._refreshAllSliderFills();
        this._updateFloatingPanel();
        // Restaura zoom/pan por cima do auto-fit que _resetSimulation já fez — arquivos de
        // antes dessa propriedade existir não têm `zoom` salvo, então mantém o auto-fit padrão.
        if (config.zoom !== undefined) {
            this.zoom = config.zoom;
            this.panX = config.panX;
            this.panY = config.panY;
            this._requestPaint();
        }
        if (!silent) Swal.fire('Sucesso!', 'Configuração importada com sucesso.', 'success');
    }

    /**
     * @private
     * @description Marca que há alterações desde o último salvar/abrir/novo — chamado nos
     * mesmos pontos que já representam uma edição de verdade (mesmo critério do undo/redo),
     * não em todo `_requestPaint` (senão rodar a simulação já marcaria "não salvo" sem o
     * usuário ter mudado nada de configuração).
     */
    _markDirty() {
        this.hasUnsavedChanges = true;
        this._updateProjectIndicator();
    }

    _updateProjectIndicator() {
        if (!this.projectIndicator) return;
        this.projectIndicator.textContent = this.activeProjectName || 'Sem título';
        this.projectIndicator.classList.toggle('unsaved', this.hasUnsavedChanges);
    }

    /**
     * @private
     * @description Lê a lista de projetos salvos localmente, mais recente primeiro. Nunca
     * lança — um valor corrompido em localStorage vira lista vazia (o autosave, separado desta
     * lista, continua intacto).
     */
    _listProjects() {
        try {
            const raw = localStorage.getItem(FluidSimulationApp.PROJECTS_KEY);
            const map = raw ? JSON.parse(raw) : {};
            return Object.values(map).sort((a, b) => b.savedAt - a.savedAt);
        } catch (err) {
            console.warn('Não foi possível ler os projetos salvos:', err);
            return [];
        }
    }

    _persistProjects(projects) {
        const map = {};
        for (const p of projects) map[p.id] = p;
        try {
            localStorage.setItem(FluidSimulationApp.PROJECTS_KEY, JSON.stringify(map));
            return true;
        } catch (err) {
            Swal.fire('Erro', `Não foi possível salvar: ${err.message}`, 'error');
            return false;
        }
    }

    _newProject() {
        const proceed = () => {
            this.clearBarriers();
            this.activeProjectId = null;
            this.activeProjectName = null;
            this.hasUnsavedChanges = false;
            this._updateProjectIndicator();
        };
        if (!this.hasUnsavedChanges) {
            proceed();
            return;
        }
        Swal.fire({
            title: 'Descartar alterações não salvas?',
            text: 'O projeto atual ainda não foi salvo. Começar um novo vai descartar essas alterações (o autosave continua guardando a última sessão, mas o projeto nomeado não).',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sim, começar novo',
            cancelButtonText: 'Cancelar'
        }).then(result => {
            if (result.isConfirmed) proceed();
        });
    }

    async _saveProject() {
        if (this.activeProjectId) {
            const projects = this._listProjects();
            const existing = projects.find(p => p.id === this.activeProjectId);
            if (existing) {
                existing.savedAt = Date.now();
                existing.config = this._buildConfigObject();
                if (this._persistProjects(projects)) {
                    this.hasUnsavedChanges = false;
                    this._updateProjectIndicator();
                }
                return;
            }
        }
        this._saveProjectAs();
    }

    async _saveProjectAs() {
        const result = await Swal.fire({
            title: 'Salvar Como',
            input: 'text',
            inputLabel: 'Nome do projeto',
            inputValue: this.activeProjectName || '',
            showCancelButton: true,
            confirmButtonText: 'Salvar',
            cancelButtonText: 'Cancelar',
            inputValidator: value => !value?.trim() && 'Digite um nome para o projeto'
        });
        if (!result.isConfirmed) return;
        const id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const projects = this._listProjects();
        projects.push({
            id,
            name: result.value.trim(),
            savedAt: Date.now(),
            config: this._buildConfigObject()
        });
        if (this._persistProjects(projects)) {
            this.activeProjectId = id;
            this.activeProjectName = result.value.trim();
            this.hasUnsavedChanges = false;
            this._updateProjectIndicator();
        }
    }

    _loadProject(id) {
        const project = this._listProjects().find(p => p.id === id);
        if (!project) {
            Swal.fire('Erro', 'Este projeto não existe mais.', 'error');
            return;
        }
        this._applyConfiguration(project.config, { silent: true });
        this.activeProjectId = project.id;
        this.activeProjectName = project.name;
        this.hasUnsavedChanges = false;
        this._updateProjectIndicator();
    }

    _deleteProject(id) {
        const projects = this._listProjects().filter(p => p.id !== id);
        this._persistProjects(projects);
        if (this.activeProjectId === id) {
            this.activeProjectId = null;
            this.activeProjectName = null;
            this._updateProjectIndicator();
        }
    }

    /**
     * @private
     * @description Diálogo (SweetAlert2, mesma dependência já usada em todo o app) listando os
     * projetos salvos localmente, com ação de abrir e de excluir por linha.
     */
    _openProjectPicker() {
        const projects = this._listProjects();
        if (projects.length === 0) {
            Swal.fire('Nenhum projeto salvo', 'Use "Salvar Como" pra guardar o projeto atual com um nome.', 'info');
            return;
        }
        const rowsHtml = projects.map(p => `
            <div class="project-row" data-id="${p.id}">
                <div class="project-row-info">
                    <strong>${this._escapeHtml(p.name)}</strong>
                    <small>${new Date(p.savedAt).toLocaleString('pt-BR')}</small>
                </div>
                <div class="project-row-actions">
                    <button type="button" class="secondary project-open-btn" data-id="${p.id}">Abrir</button>
                    <button type="button" class="icon-button project-delete-btn" data-id="${p.id}" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>
        `).join('');
        Swal.fire({
            title: 'Abrir Projeto',
            html: `<div class="project-list">${rowsHtml}</div>`,
            showConfirmButton: false,
            showCloseButton: true,
            width: 480,
            didOpen: popup => {
                popup.querySelectorAll('.project-open-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        Swal.close();
                        this._loadProject(btn.dataset.id);
                    });
                });
                popup.querySelectorAll('.project-delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const project = projects.find(p => p.id === btn.dataset.id);
                        const confirm = await Swal.fire({
                            title: 'Excluir projeto?',
                            text: project ? project.name : '',
                            icon: 'warning',
                            showCancelButton: true,
                            confirmButtonText: 'Excluir',
                            cancelButtonText: 'Cancelar'
                        });
                        if (confirm.isConfirmed) this._deleteProject(btn.dataset.id);
                        this._openProjectPicker();
                    });
                });
            }
        });
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
