import { RecordsConfig } from "./records";
export declare class DomainConfig {
    name: string;
    records?: RecordsConfig;
    enabled: boolean;
    timeout: number;
    constructor(name: string);
    isRecordEnabled(type: string): boolean;
    isReverseDNSEnabled(type: string): boolean;
}
