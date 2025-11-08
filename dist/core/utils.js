"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeIdentifier = exports.nowIso = exports.sleep = void 0;
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
exports.sleep = sleep;
const nowIso = () => new Date().toISOString();
exports.nowIso = nowIso;
const sanitizeIdentifier = (value) => {
    return value.replace(/[^a-zA-Z0-9_\-:.]/g, "_");
};
exports.sanitizeIdentifier = sanitizeIdentifier;
//# sourceMappingURL=utils.js.map