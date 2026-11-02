// Anexa os métodos de uma classe-"mixin" ao protótipo do app. Serve para dividir o
// FluidSimulationApp em vários arquivos sem alterar o corpo dos métodos: `this` continua sendo a
// instância do app. Recusa sobrescrever um método que já exista (nome duplicado entre arquivos).
export function applyMixin(target, Source) {
    for (const name of Object.getOwnPropertyNames(Source.prototype)) {
        if (name === 'constructor') continue;
        if (Object.prototype.hasOwnProperty.call(target, name)) {
            throw new Error(`Método duplicado ao aplicar ${Source.name}: ${name}`);
        }
        Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(Source.prototype, name));
    }
}
