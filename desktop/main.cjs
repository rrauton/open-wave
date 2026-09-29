const {app,BrowserWindow,ipcMain,dialog,session}=require('electron');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
let engine,win,origin='',tail='',closing=false;
const token=randomBytes(32).toString('hex');
function trusted(event){if(!win||event.sender!==win.webContents||new URL(event.senderFrame.url).origin!==origin)throw Error('Untrusted request');}
async function boot(){
 const root=path.join(__dirname,'..');
 const executable=app.isPackaged?path.join(process.resourcesPath,'engine','open-wave-engine.exe'):path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
 const args=app.isPackaged?[]:[path.join(root,'companion','entry.py')];
 engine=spawn(executable,args,{windowsHide:true,env:{...process.env,OPEN_WAVE_TOKEN:token,OPEN_WAVE_WEB_ROOT:app.isPackaged?path.join(process.resourcesPath,'web'):path.join(root,'dist'),TORCH_HOME:path.join(app.getPath('userData'),'models'),HF_HOME:path.join(app.getPath('userData'),'model-downloads')},stdio:['pipe','pipe','pipe']});
 engine.stderr.on('data',d=>{tail=(tail+d).slice(-6000);});
 const port=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>reject(Error('Local engine startup timed out. '+tail)),120000);engine.once('error',e=>{clearTimeout(timeout);reject(e)});engine.once('exit',code=>{clearTimeout(timeout);reject(Error('Local engine stopped ('+code+'). '+tail));});engine.stdout.on('data',d=>{output+=d;const match=output.match(/OPEN_WAVE_PORT=(\d+)/);if(match){clearTimeout(timeout);resolve(Number(match[1]));}});});
 origin=`http://127.0.0.1:${port}`;
 session.defaultSession.webRequest.onBeforeSendHeaders((details,callback)=>{if(details.url.startsWith(origin+'/'))details.requestHeaders['X-Open-Wave-Token']=token;callback({requestHeaders:details.requestHeaders});});
 session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents===win?.webContents&&details.requestingUrl.startsWith(origin+'/')&&permission==='media'));
 win=new BrowserWindow({width:1440,height:950,minWidth:1000,minHeight:650,backgroundColor:'#101519',autoHideMenuBar:true,title:'Open Wave',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
 await win.loadURL(origin);
 win.on('close',event=>{if(!closing){const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['Keep editing','Quit'],defaultId:0,cancelId:0,message:'Have you saved your project?',detail:'Use Save project file to keep your audio and edits.'});if(choice===0)event.preventDefault();else closing=true;}});
}
ipcMain.handle('save-project',async(event,text)=>{trusted(event);if(typeof text!=='string'||text.length>1024*1024*1024)throw Error('Invalid project');JSON.parse(text);const result=await dialog.showSaveDialog(win,{defaultPath:'Untitled.pulse.json',filters:[{name:'Open Wave project',extensions:['pulse.json']}]});if(result.canceled)return false;const tmp=result.filePath+'.tmp';await fs.writeFile(tmp,text,'utf8');await fs.rename(tmp,result.filePath);return true;});
ipcMain.handle('open-project',async event=>{trusted(event);const result=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'Open Wave project',extensions:['json']}]});if(result.canceled)return null;const size=(await fs.stat(result.filePaths[0])).size;if(size>1024*1024*1024)throw Error('Project exceeds 1 GB');return fs.readFile(result.filePaths[0],'utf8');});
app.setPath('userData',path.join(app.getPath('appData'),'pulse-daw-desktop'));
app.whenReady().then(boot).catch(error=>{dialog.showErrorBox('Open Wave could not start',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{closing=true;if(engine&&!engine.killed){engine.stdin.end();setTimeout(()=>engine?.kill(),3000).unref();}});
