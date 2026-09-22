/** 供前端（TS/ESM）以类型安全的方式引用共享的能力规则 */
export type CapabilityRule = { p: string; caps: string[] };
declare const rules: { rules: CapabilityRule[]; default: string[] };
export default rules;
