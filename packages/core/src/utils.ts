export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const nowIso = (): string => new Date().toISOString();

export const sanitizeIdentifier = (value: string): string => {
  return value.replace(/[^a-zA-Z0-9_\-:.]/g, "_");
};
