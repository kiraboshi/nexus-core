export const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
export const nowIso = () => new Date().toISOString();
export const sanitizeIdentifier = (value) => {
    return value.replace(/[^a-zA-Z0-9_\-:.]/g, "_");
};
//# sourceMappingURL=utils.js.map