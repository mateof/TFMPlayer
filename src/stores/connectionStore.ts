import { create } from 'zustand';

/**
 * The server answered 401 to the saved API key. The configuration is kept
 * (a key changed on the server, a route that suddenly asks for it...), and
 * the shell shows a banner leading to the server settings instead.
 */
interface ConnectionState {
  unauthorized: boolean;
  setUnauthorized: (value: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  unauthorized: false,
  setUnauthorized: (value) => set((s) => (s.unauthorized === value ? s : { unauthorized: value }))
}));

export function reportUnauthorized(): void {
  useConnectionStore.getState().setUnauthorized(true);
}

export function reportAuthorized(): void {
  useConnectionStore.getState().setUnauthorized(false);
}
