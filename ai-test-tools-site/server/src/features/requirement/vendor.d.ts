declare module "mammoth" {
  export interface MammothMessage {
    type: string;
    message: string;
  }
  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<MammothResult>;
}
