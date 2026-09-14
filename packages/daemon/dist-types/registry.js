/** In-memory map of known workspaces and which of them currently have a VS Code window connected. */
export class Registry {
    records = new Map();
    connections = new Map();
    upsert(r) {
        this.records.set(r.workspaceId, { ...r });
    }
    get(id) {
        return this.records.get(id);
    }
    all() {
        return [...this.records.values()];
    }
    attach(id, c) {
        this.connections.set(id, c);
    }
    detach(c) {
        const ids = [];
        for (const [id, conn] of this.connections) {
            if (conn === c) {
                this.connections.delete(id);
                ids.push(id);
            }
        }
        return ids;
    }
    connection(id) {
        return this.connections.get(id);
    }
    connectedIds() {
        return [...this.connections.keys()];
    }
}
//# sourceMappingURL=registry.js.map