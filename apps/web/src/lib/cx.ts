/** Joins class names, skipping falsy ones. */
export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(' ');
