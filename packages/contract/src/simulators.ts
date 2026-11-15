export const simulators = ['msfs2020', 'msfs2024'] as const;
export type SimulatorId = (typeof simulators)[number];
