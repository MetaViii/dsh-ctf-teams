export interface EvidenceFile {
    path: string;
    sha256: string;
    bytes: number;
    capturedAt: number;
}
export declare const EVIDENCE_FILE_LIMIT = 8;
export declare const EVIDENCE_FILE_MAX_BYTES: number;
export declare function captureEvidenceFiles(workspace: string, paths?: readonly string[]): Promise<EvidenceFile[]>;
export declare function inspectEvidenceFiles(workspace: string, files: readonly EvidenceFile[]): Promise<({
    path: string;
    status: string;
    expected_sha256: string;
    current_sha256: string;
} | {
    path: string;
    status: string;
    expected_sha256?: undefined;
    current_sha256?: undefined;
})[]>;
