/** Arquivos do pacote (caminho → bytes), com as regras TypeScript já compiladas. */
export function packGame(dir: string): Promise<Record<string, Uint8Array>>;
/** O .bqgame (zip) da pasta. */
export function packGameZip(dir: string): Promise<Uint8Array>;
