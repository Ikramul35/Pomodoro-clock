import { writable } from 'svelte/store';

export const workDur = writable(25);
export const breakDur = writable(5);
export const longBreakDur = writable(15);
export const noOfSession = writable(4);
