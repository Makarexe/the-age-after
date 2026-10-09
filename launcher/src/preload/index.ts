import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/constants';

type Channel = 'progress' | 'gameState' | 'update';

// Only a generic invoke and three event channels cross the bridge; main whitelists the methods.
contextBridge.exposeInMainWorld('launcherBridge', {
  invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke(IPC.invoke, method, ...args),
  on: (channel: Channel, listener: (payload: unknown) => void) => {
    const name = IPC[channel];
    const wrapped = (_e: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(name, wrapped);
    return () => ipcRenderer.removeListener(name, wrapped);
  },
});
