// Elementos de interface do FluidSimulationApp: tooltip customizado, menus e preenchimento dos
// sliders. Extraído de FluidSimulationApp.js; os métodos são anexados ao protótipo do app por
// applyMixin, então `this` é a instância do app.

export class UiChrome {
    /**
     * @private
     * @description Bug 22 — Tooltip customizado: intercepta qualquer elemento com [data-tooltip]
     * ou [title] (exceto inputs/selects) e exibe um balão estilizado com delay de 400ms.
     * O tooltip fica acima do elemento sempre que couber na viewport, caso contrário aparece
     * abaixo. Ao mover o mouse ou pressionar um botão o tooltip some imediatamente.
     */
    _initTooltip() {
        this._tooltipEl = document.getElementById('app-tooltip');
        if (!this._tooltipEl) return;
        let _tooltipTimer = null;

        const show = (text, targetEl) => {
            clearTimeout(_tooltipTimer);
            _tooltipTimer = setTimeout(() => {
                const rect = targetEl.getBoundingClientRect();
                this._tooltipEl.textContent = text;
                // Posiciona temporariamente fora da tela pra medir largura real antes de mostrar
                this._tooltipEl.style.left = '-9999px';
                this._tooltipEl.style.top = '-9999px';
                this._tooltipEl.classList.remove('visible');

                const tw = this._tooltipEl.offsetWidth;
                const th = this._tooltipEl.offsetHeight;
                const margin = 6;
                let left = rect.left + (rect.width - tw) / 2;
                left = Math.max(margin, Math.min(window.innerWidth - tw - margin, left));

                // Acima do elemento se couber na viewport, senão abaixo
                const topAbove = rect.top - th - margin;
                const top = topAbove >= margin ? topAbove : rect.bottom + margin;

                this._tooltipEl.style.left = `${left}px`;
                this._tooltipEl.style.top = `${top}px`;
                requestAnimationFrame(() => this._tooltipEl.classList.add('visible'));
            }, 400);
        };

        const hide = () => {
            clearTimeout(_tooltipTimer);
            this._tooltipEl.classList.remove('visible');
        };

        // Delegação de eventos — captura qualquer elemento com tooltip na página inteira
        document.addEventListener('mouseover', (e) => {
            const target = e.target.closest('[data-tooltip], [title]:not(input):not(select):not(textarea)');
            if (!target) { hide(); return; }
            const text = target.dataset.tooltip || target.getAttribute('title') || '';
            if (!text) { hide(); return; }
            show(text, target);
        });
        document.addEventListener('mouseout', (e) => {
            const toEl = e.relatedTarget;
            const isStillInTarget = toEl && toEl.closest('[data-tooltip], [title]:not(input):not(select):not(textarea)');
            if (!isStillInTarget) hide();
        });
        document.addEventListener('mousedown', hide);
        document.addEventListener('scroll', hide, true);
    }

    /**
     * @private
     * @description Liga a interação da barra de menu (Arquivo/Editar/Exibir): clicar num
     * "trigger" abre/fecha seu dropdown e fecha qualquer outro aberto; clicar num item dentro
     * do dropdown fecha o menu depois (a ação em si já está ligada nos botões individualmente);
     * clique fora de qualquer menu, ou Escape (tratado no listener de keydown), fecha tudo.
     */
    _bindMenuBar() {
        this.menuItems.forEach(item => {
            const trigger = item.querySelector('.menu-trigger');
            const dropdown = item.querySelector('.menu-dropdown');
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const wasOpen = dropdown.classList.contains('open');
                this._closeAllMenus();
                if (!wasOpen) dropdown.classList.add('open');
            });
            dropdown.addEventListener('click', (e) => {
                if (e.target.closest('button')) this._closeAllMenus();
            });
        });
        document.addEventListener('click', () => this._closeAllMenus());
    }

    _closeAllMenus() {
        document.querySelectorAll('.menu-dropdown.open').forEach(dropdown => dropdown.classList.remove('open'));
    }

    /**
     * @private
     * @description Sincroniza a variável CSS `--fill` de cada slider com seu valor atual,
     * para que o trilho apareça preenchido até a posição do thumb.
     */
    _initSliderFills() {
        this.root.querySelectorAll('input[type="range"]').forEach(slider => {
            this._updateSliderFill(slider);
            slider.addEventListener('input', () => this._updateSliderFill(slider));
        });
    }

    _updateSliderFill(slider) {
        const min = Number(slider.min) || 0;
        const max = Number(slider.max) || 100;
        const pct = max > min ? ((Number(slider.value) - min) / (max - min)) * 100 : 0;
        slider.style.setProperty('--fill', `${pct}%`);
    }

    _refreshAllSliderFills() {
        this.root.querySelectorAll('input[type="range"]').forEach(slider => this._updateSliderFill(slider));
    }
}
