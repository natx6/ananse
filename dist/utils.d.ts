export interface AnanseConfig {
    apiKey?: string;
    provider?: string;
    model?: string;
    baseURL?: string;
    userName?: string;
}
export interface ProjectPersonality {
    path: string;
    content: string;
}
export interface BootCheckResult {
    config: AnanseConfig | null;
    personality: ProjectPersonality | null;
    fileCount: number;
}
export declare function checkConfig(): Promise<AnanseConfig | null>;
export declare function checkPersonality(): Promise<ProjectPersonality | null>;
export declare function scanDirectory(): Promise<number>;
export declare function bootCheck(): Promise<BootCheckResult>;
//# sourceMappingURL=utils.d.ts.map