import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface PriceData {
    eurGbp: number;
    eurJpy: number;
    eurUsd: number;
    usdCad: number;
    usdJpy: number;
    audUsd: number;
    nzdUsd: number;
    gbpUsd: number;
}
export interface TransformationOutput {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export type Result = {
    __kind__: "ok";
    ok: PriceData;
} | {
    __kind__: "err";
    err: string;
};
export interface TransformationInput {
    context: Uint8Array;
    response: http_request_result;
}
export type Result_1 = {
    __kind__: "ok";
    ok: PriceData | null;
} | {
    __kind__: "err";
    err: string;
};
export interface http_header {
    value: string;
    name: string;
}
export interface http_request_result {
    status: bigint;
    body: Uint8Array;
    headers: Array<http_header>;
}
export interface backendInterface {
    /**
     * / Returns the last time prices were fetched
     */
    getLastFetchTime(): Promise<bigint>;
    /**
     * / Returns last cached prices if available
     */
    getLastPrices(): Promise<Result_1>;
    getLivePrices(): Promise<Result>;
    /**
     * / Transform callback for filtering HTTP response headers.
     */
    transform(input: TransformationInput): Promise<TransformationOutput>;
}
