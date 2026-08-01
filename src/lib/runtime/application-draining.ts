const globalForApplicationDraining = globalThis as typeof globalThis & {
  badactionApplicationDraining?: boolean;
};

export const beginApplicationDraining = (): void => {
  globalForApplicationDraining.badactionApplicationDraining = true;
};

export const isApplicationDraining = (): boolean =>
  globalForApplicationDraining.badactionApplicationDraining === true;
