if(window.openWaveDesktop){
 $('#saveBtn').textContent='Save project file';$('#loadBtn').textContent='Open project file';
 $('#saveBtn').onclick=async()=>{try{if(await openWaveDesktop.saveProject(JSON.stringify(serialize())))$('#saveStatus').textContent='Saved to disk';}catch(e){toast('Save failed: '+e.message)}};
 $('#loadBtn').onclick=async()=>{try{const text=await openWaveDesktop.openProject();if(!text)return;const project=JSON.parse(text);if(!Array.isArray(project.tracks)||!Array.isArray(project.clips)||typeof project.name!=='string')throw Error('Invalid Open Wave project');for(const c of project.clips){if(typeof c.name!=='string'||!Number.isFinite(c.start)||c.start<0||!Number.isFinite(c.duration)||c.duration<=0||!Array.isArray(c.raw)||!Array.isArray(c.peaks))throw Error('Invalid clip data');}if(clips.length&&!confirm('Open this project? Save current edits first.'))return;await loadProject(project);}catch(e){toast('Open failed: '+e.message)}};
}
