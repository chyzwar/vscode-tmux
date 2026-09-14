"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaemonClient = void 0;
const node_crypto_1 = require("node:crypto");
const node_net_1 = require("node:net");
const protocol_1 = require("@vscode-tmux/protocol");
/** NDJSON client for the daemon socket, used by the extension host. */
class DaemonClient {
    socketPath;
    socket;
    decoder = new protocol_1.NdjsonDecoder();
    pending = new Map();
    requestHandler;
    disconnectHandler;
    constructor(socketPath) {
        this.socketPath = socketPath;
    }
    get connected() {
        return this.socket !== undefined && !this.socket.destroyed;
    }
    connect(timeoutMs = 2000) {
        return new Promise((resolve, reject) => {
            const socket = (0, node_net_1.createConnection)(this.socketPath);
            socket.setEncoding('utf8');
            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error('connect timeout'));
            }, timeoutMs);
            socket.once('connect', () => {
                clearTimeout(timer);
                this.socket = socket;
                resolve();
            });
            socket.once('error', (err) => {
                clearTimeout(timer);
                if (this.socket === socket)
                    this.socket = undefined;
                reject(err);
            });
            socket.on('data', (chunk) => {
                for (const msg of this.decoder.push(chunk))
                    void this.dispatch(msg);
            });
            socket.on('close', () => {
                if (this.socket === socket)
                    this.socket = undefined;
                for (const p of this.pending.values()) {
                    clearTimeout(p.timer);
                    p.reject(new Error('daemon connection closed'));
                }
                this.pending.clear();
                this.disconnectHandler?.();
            });
        });
    }
    onRequest(handler) {
        this.requestHandler = handler;
    }
    onDisconnect(handler) {
        this.disconnectHandler = handler;
    }
    send(msg) {
        if (this.socket && !this.socket.destroyed)
            this.socket.write((0, protocol_1.encode)(msg));
    }
    request(msg, timeoutMs = 15_000) {
        const id = msg.id ?? (0, node_crypto_1.randomUUID)();
        const withId = { ...msg, id };
        return new Promise((resolve, reject) => {
            if (!this.connected)
                return reject(new Error('not connected to daemon'));
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`timeout waiting for ${msg.type} reply`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.send(withId);
        });
    }
    close() {
        this.socket?.end();
        this.socket = undefined;
    }
    async dispatch(msg) {
        const id = msg.id;
        if (msg.type === 'result' && id && this.pending.has(id)) {
            const p = this.pending.get(id);
            this.pending.delete(id);
            clearTimeout(p.timer);
            p.resolve(msg);
            return;
        }
        if (this.requestHandler) {
            const reply = await this.requestHandler(msg);
            this.send(reply);
        }
    }
}
exports.DaemonClient = DaemonClient;
//# sourceMappingURL=client.js.map