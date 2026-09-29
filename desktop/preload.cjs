const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('openWaveDesktop',Object.freeze({saveProject:text=>ipcRenderer.invoke('save-project',text),openProject:()=>ipcRenderer.invoke('open-project')}));
