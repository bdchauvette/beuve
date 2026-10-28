import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('beuve', Object.freeze({ version: '0.1.0' }));
