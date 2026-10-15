export interface TextCandidate {
    text: string;
    substitutions: number;
    base64?: {
        valid: boolean;
        hex?: string;
        ascii?: string;
        bytes?: number;
        preview_truncated?: boolean;
    };
}
/** Enumerate by edit distance, with explicit finite limits; never guesses the accepted flag. */
export declare function textCandidates(input: {
    text: string;
    max_candidates?: number;
    decode_base64?: boolean;
    preview_bytes?: number;
}): {
    candidates: TextCandidate[];
    total_variants: string;
    truncated: boolean;
    notice: string;
};
