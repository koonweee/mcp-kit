export type JoseModule = typeof import('jose');

export declare function loadJose(): Promise<JoseModule>;
